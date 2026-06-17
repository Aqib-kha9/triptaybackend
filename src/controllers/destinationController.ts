import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/db.js";
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
    const existing = await prisma.destination.findFirst({
      where: {
        slug,
        id: excludeId ? { not: excludeId } : undefined,
      },
    });
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
}

// Helper to map flat database lat/lng to frontend-compatible coordinates object
function mapDestinationResponse(dest: any) {
  if (!dest) return null;
  const mapped = {
    ...dest,
    _id: dest.id,
    coordinates: {
      lat: dest.lat,
      lng: dest.lng,
    },
  };
  delete mapped.lat;
  delete mapped.lng;
  return mapped;
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

    const filter: any = { isActive: true };
    if (category && ["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
      filter.category = category;
    }

    const [destinations, total] = await Promise.all([
      prisma.destination.findMany({
        where: filter,
        orderBy: [{ popularityScore: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.destination.count({
        where: filter,
      }),
    ]);

    const mapped = destinations.map(mapDestinationResponse);

    res.status(200).json({
      status: "success",
      data: {
        destinations: mapped,
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
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const destination = await prisma.destination.findFirst({
      where: {
        slug: req.params.slug,
        isActive: true,
      },
    });

    if (!destination) {
      res.status(404).json({ status: "fail", message: "Destination not found." });
      return;
    }

    res.status(200).json({
      status: "success",
      data: { destination: mapDestinationResponse(destination) },
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

    const destination = await prisma.destination.create({
      data: {
        name,
        slug,
        state,
        city,
        image,
        category,
        lat: coordinates.lat,
        lng: coordinates.lng,
        description: description || "",
        popularityScore: 0,
      },
    });

    res.status(201).json({
      status: "success",
      data: { destination: mapDestinationResponse(destination) },
    });
  } catch (err: any) {
    // Handle duplicate slug race condition (P2002 in Prisma)
    if (err.code === "P2002") {
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

    const destination = await prisma.destination.findUnique({
      where: { id: req.params.id },
    });
    if (!destination) {
      res.status(404).json({ status: "fail", message: "Destination not found." });
      return;
    }

    const updateData: any = {};

    if (name !== undefined) {
      updateData.name = name;
      const newSlug = generateSlug(name);
      updateData.slug = await ensureUniqueSlug(newSlug, destination.id);
    }
    if (state !== undefined) updateData.state = state;
    if (city !== undefined) updateData.city = city;
    if (image !== undefined) updateData.image = image;
    if (category !== undefined) {
      if (!["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
        res.status(400).json({
          status: "fail",
          message: "Invalid category. Must be: Nature, Adventure, Historical, or Spiritual",
        });
        return;
      }
      updateData.category = category;
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
      updateData.lat = coordinates.lat;
      updateData.lng = coordinates.lng;
    }
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (popularityScore !== undefined) updateData.popularityScore = popularityScore;

    const updated = await prisma.destination.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.status(200).json({
      status: "success",
      data: { destination: mapDestinationResponse(updated) },
    });
  } catch (err: any) {
    if (err.code === "P2002") {
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
    const destination = await prisma.destination.findUnique({
      where: { id: req.params.id },
    });

    if (!destination) {
      res.status(404).json({ status: "fail", message: "Destination not found." });
      return;
    }

    await prisma.destination.delete({
      where: { id: req.params.id },
    });

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

    const filter: any = {};
    if (!includeInactive) filter.isActive = true;
    if (category && ["Nature", "Adventure", "Historical", "Spiritual"].includes(category)) {
      filter.category = category;
    }

    const [destinations, total] = await Promise.all([
      prisma.destination.findMany({
        where: filter,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.destination.count({
        where: filter,
      }),
    ]);

    const mapped = destinations.map(mapDestinationResponse);

    res.status(200).json({
      status: "success",
      data: {
        destinations: mapped,
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