import type { Request, Response, NextFunction } from "express";
import * as listingService from "../services/listing.service.js";
import { prisma } from "../config/db.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a new listing
// @route   POST /api/listings
// @access  Private (Vendor / Dual Mode)
export const createListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const listing = await listingService.createListing(req.user.id, req.body);

    const result = listingService.mapListingResponse(listing as unknown as Record<string, unknown>);
    const enriched = await listingService.populateHostForListing(
      listing as unknown as Record<string, unknown>,
    );

    res.status(201).json({
      status: "success",
      data: {
        listing: enriched,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all listings for current vendor
// @route   GET /api/listings
// @access  Private
export const getMyListings = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, page, limit } = req.query;
    const result = await listingService.getMyListings(req.user.id, { status, page, limit });

    res.status(200).json({
      status: "success",
      results: result.listings.length,
      pagination: result.pagination,
      data: {
        listings: result.listings,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single listing by ID
// @route   GET /api/listings/:id
// @access  Private
export const getListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const listing = await listingService.getListing(req.params.id);
    const enriched = await listingService.populateHostForListing(
      listing as unknown as Record<string, unknown>,
    );

    res.status(200).json({
      status: "success",
      data: {
        listing: enriched,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a listing
// @route   PUT /api/listings/:id
// @access  Private
export const updateListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const listing = await listingService.updateListing(req.params.id, req.user.id, req.body);

    res.status(200).json({
      status: "success",
      data: {
        listing,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a listing
// @route   DELETE /api/listings/:id
// @access  Private
export const deleteListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await listingService.deleteListing(req.params.id, req.user.id);

    res.status(200).json({
      status: "success",
      message: "Listing deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload media files to a listing
// @route   POST /api/listings/:id/media
// @access  Private
export const uploadListingMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await listingService.uploadListingMedia(
      req.params.id,
      req.user.id,
      req.files as Express.Multer.File[],
      req.body as Record<string, string>,
    );

    res.status(200).json({
      status: "success",
      message: "Media uploaded successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a media item from a listing
// @route   DELETE /api/listings/:id/media/:mediaId
// @access  Private
export const deleteListingMedia = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await listingService.deleteListingMedia(
      req.params.id,
      req.user.id,
      req.params.mediaId,
    );

    res.status(200).json({
      status: "success",
      message: "Media deleted successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Browse published listings (public)
// @route   GET /api/listings/browse
// @access  Public
export const browseListings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { city, state, propertyType, minPrice, maxPrice, guests, bedrooms, bathrooms, amenities, sort, page, limit } =
      req.query as Record<string, string>;

    const result = await listingService.browseListings({
      city,
      state,
      propertyType,
      minPrice,
      maxPrice,
      guests,
      bedrooms,
      bathrooms,
      amenities,
      sort,
      page,
      limit,
    });

    // Enrich listings with host info
    const enriched = await Promise.all(
      result.listings.map(async (l) => {
        if (!l) return l;
        const enrichedListing = await listingService.populateHostForListing(
          l as unknown as Record<string, unknown>,
        );
        return enrichedListing;
      }),
    );

    res.status(200).json({
      status: "success",
      results: enriched.length,
      pagination: result.pagination,
      data: {
        listings: enriched,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a public listing by slug
// @route   GET /api/public/listing/:slug
// @access  Public
export const getPublicListing = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const listing = await listingService.getPublicListing(req.params.slug);

    res.status(200).json({
      status: "success",
      data: {
        listing,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Location suggestions for autocomplete
// @route   GET /api/locations/suggest
// @access  Public
export const locationSuggestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = (req.query.q as string) || "";
    const result = await listingService.locationSuggestions(query);

    res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Browse nearby listings and activities
// @route   GET /api/nearby/browse
// @access  Public
export const browseNearby = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseInt((req.query.radius as string) || "50", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);

    const result = await listingService.browseNearby(lat, lng, radius, limit);

    res.status(200).json({
      status: "success",
      results: result.total,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get blocked and booked dates for a listing (public)
// @route   GET /api/public/listings/:id/availability
// @access  Public
export const getListingAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const now = new Date();

    // 1. Get blocked dates from Availability
    const availability = await prisma.availability.findUnique({
      where: { itemId_itemType: { itemId: id, itemType: "listing" } },
    });
    const blockedDates = availability ? availability.blockedDates : [];

    // 2. Get active bookings that genuinely block the calendar.
    //    A booking blocks dates only if it is:
    //      - "confirmed" (always), OR
    //      - "pending" AND still within its payment window (expiresAt null or >= now)
    //    Expired bookings and stale pending bookings (past expiry) are excluded so
    //    their dates show as available — matching Airbnb/Amazon inventory-hold behaviour
    //    where an abandoned/failed checkout releases the dates immediately.
    const bookings = await prisma.booking.findMany({
      where: {
        itemId: id,
        itemType: "listing",
        status: { in: ["pending", "confirmed"] },
        OR: [
          { status: "confirmed" },
          {
            status: "pending",
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
        ],
      },
      select: {
        checkIn: true,
        checkOut: true,
      },
    });

    const bookedDates: string[] = [];
    bookings.forEach((booking) => {
      if (!booking.checkIn || !booking.checkOut) return;
      const start = new Date(booking.checkIn);
      const end = new Date(booking.checkOut);
      const current = new Date(start);
      while (current < end) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, "0");
        const d = String(current.getDate()).padStart(2, "0");
        bookedDates.push(`${y}-${m}-${d}`);
        current.setDate(current.getDate() + 1);
      }
    });

    res.status(200).json({
      status: "success",
      data: {
        blockedDates,
        bookedDates,
      },
    });
  } catch (error) {
    next(error);
  }
};