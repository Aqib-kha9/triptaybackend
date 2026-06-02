import type { Request, Response, NextFunction } from "express";
import Destination from "../models/Destination.js";
import cloudinary from "../config/cloudinary.js";
import { validateMagicBytes } from "../utils/validateMagicBytes.js";

// ─── Helper: auto-generate slug from name ───
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Helper: ensure unique slug (append counter if needed) ───
async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const query: Record<string, unknown> = { slug };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await Destination.findOne(query);
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
}

// ─── GET /api/destinations — public, paginated, sorted by popularity ───
export const getAllDestinations = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 12));
    const category = req.query.category as string | undefined;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { isActive: true };
    if (category && ["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
      filter.category = category;
    }

    const [destinations, total] = await Promise.all([
      Destination.find(filter)
        .sort({ popularityScore: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Destination.countDocuments(filter),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        destinations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/destinations/:slug — public, single destination by slug ───
export const getDestination = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const destination = await Destination.findOne({
      slug: req.params.slug,
      isActive: true,
    }).lean();

    if (!destination) {
      res.status(404).json({ status: "fail", message: "Destination not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { destination },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/destinations — admin creates a destination ───
export const createDestination = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, state, city, image, category, coordinates, description } = req.body;

    // Validate required fields
    if (!name || !state || !city || !image || !category || !coordinates) {
      res.status(400).json({
        status: "fail",
        message: "Missing required fields: name, state, city, image, category, coordinates",
      });
      return;
    }

    if (!["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
      res.status(400).json({
        status: "fail",
        message: "Invalid category. Must be: Nature, Adventure, Historical, or Spiritual",
      });
      return;
    }

    if (
      typeof coordinates.lat !== "number" ||
      typeof coordinates.lng !== "number"
    ) {
      res.status(400).json({
        status: "fail",
        message: "Coordinates must include numeric lat and lng",
      });
      return;
    }

    const baseSlug = generateSlug(name);
    const slug = await ensureUniqueSlug(baseSlug);

    const destination = await Destination.create({
      name,
      slug,
      state,
      city,
      image,
      category,
      coordinates,
      description: description || "",
      popularityScore: 0,
    });

    res.status(201).json({
      status: "success",
      data: { destination },
    });
  } catch (err: any) {
    // Handle duplicate slug race condition
    if (err.code === 11000) {
      res.status(409).json({
        status: "fail",
        message: "A destination with this name/slug already exists.",
      });
      return;
    }
    next(err);
  }
};

// ─── PUT /api/admin/destinations/:id — admin updates a destination ───
export const updateDestination = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, state, city, image, category, coordinates, description, isActive, popularityScore } =
      req.body;

    const destination = await Destination.findById(req.params.id);
    if (!destination) {
      res.status(404).json({ status: "fail", message: "Destination not found." });
      return;
    }

    // Update fields if provided
    if (name !== undefined) {
      destination.name = name;
      const newSlug = generateSlug(name);
      destination.slug = await ensureUniqueSlug(newSlug, destination._id as string);
    }
    if (state !== undefined) destination.state = state;
    if (city !== undefined) destination.city = city;
    if (image !== undefined) destination.image = image;
    if (category !== undefined) {
      if (!["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
        res.status(400).json({
          status: "fail",
          message: "Invalid category. Must be: Nature, Adventure, Historical, or Spiritual",
        });
        return;
      }
      destination.category = category;
    }
    if (coordinates !== undefined) {
      if (
        typeof coordinates.lat !== "number" ||
        typeof coordinates.lng !== "number"
      ) {
        res.status(400).json({
          status: "fail",
          message: "Coordinates must include numeric lat and lng",
        });
        return;
      }
      destination.coordinates = coordinates;
    }
    if (description !== undefined) destination.description = description;
    if (isActive !== undefined) destination.isActive = Boolean(isActive);
    if (popularityScore !== undefined) destination.popularityScore = popularityScore;

    await destination.save();

    res.status(200).json({
      status: "success",
      data: { destination },
    });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({
        status: "fail",
        message: "A destination with this slug already exists.",
      });
      return;
    }
    next(err);
  }
};

// ─── DELETE /api/admin/destinations/:id — admin deletes a destination ───
export const deleteDestination = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const destination = await Destination.findByIdAndDelete(req.params.id);

    if (!destination) {
      res.status(404).json({ status: "fail", message: "Destination not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      message: `Destination "${destination.name}" deleted successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/destinations — admin lists all destinations (including inactive) ───
export const adminListDestinations = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const category = req.query.category as string | undefined;
    const includeInactive = req.query.includeInactive === "true";
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (!includeInactive) filter.isActive = true;
    if (category && ["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
      filter.category = category;
    }

    const [destinations, total] = await Promise.all([
      Destination.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Destination.countDocuments(filter),
    ]);

    res.status(200).json({
      status: "success",
      data: {
        destinations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/destinations/upload-image — Cloudinary image upload for destinations ───
export const uploadDestinationImage = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ status: "fail", message: "No file uploaded." });
      return;
    }

    if (!req.file.buffer || req.file.buffer.length === 0) {
      res.status(400).json({ status: "fail", message: "Uploaded file is empty." });
      return;
    }

    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      res.status(400).json({
        status: "fail",
        message: "File content does not match its declared type. Upload rejected for security.",
      });
      return;
    }

    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const uploaded = await cloudinary.uploader.upload(b64, {
      folder: "triptay/destinations",
      resource_type: "image",
      public_id: `dest_${Date.now()}`,
      transformation: { width: 1200, height: 800, crop: "fill", quality: "auto" },
    });

    res.status(200).json({
      status: "success",
      message: "Destination image uploaded successfully.",
      data: {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
      },
    });
  } catch (error) {
    next(error);
  }
};