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
    const { city, state, propertyType, minPrice, maxPrice, guests, rooms, bedrooms, bathrooms, amenities, sort, page, limit } =
      req.query as Record<string, string>;

    const result = await listingService.browseListings({
      city,
      state,
      propertyType,
      minPrice,
      maxPrice,
      guests,
      rooms,
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

    // 1. Get blocked dates from Availability (host-blocked dates apply to both listing types)
    const availability = await prisma.availability.findUnique({
      where: { itemId_itemType: { itemId: id, itemType: "listing" } },
    });
    const blockedDates = availability ? availability.blockedDates : [];

    // 2. Fetch listing to determine type
    const listing = await prisma.listing.findUnique({
      where: { id },
      select: { isEntirePlace: true, rooms: { select: { id: true, inventory: true } } },
    });

    let bookedDates: string[] = [];

    if (!listing || listing.isEntirePlace) {
      // ── Entire Place: any active booking blocks all dates ──
      // A booking blocks dates only if:
      //   - "confirmed" (always), OR
      //   - "pending" AND still within its payment window (expiresAt null or >= now)
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
        select: { checkIn: true, checkOut: true },
      });

      bookings.forEach((booking) => {
        if (!booking.checkIn || !booking.checkOut) return;
        const current = new Date(booking.checkIn);
        const end = new Date(booking.checkOut);
        while (current < end) {
          const y = current.getFullYear();
          const m = String(current.getMonth() + 1).padStart(2, "0");
          const d = String(current.getDate()).padStart(2, "0");
          bookedDates.push(`${y}-${m}-${d}`);
          current.setDate(current.getDate() + 1);
        }
      });
    } else {
      // ── Room-Based Listing: compute dates where ALL rooms are fully booked ──
      // For hotel-style listings with multiple independent rooms, a date is only
      // "fully booked" when every room type's inventory is 0 (Booking.com / MakeMyTrip style).
      // The detailed per-room inventory check happens at booking time.
      const roomInventoryMap: Record<string, number> = {};
      const totalInventory = listing.rooms.reduce((sum, r) => {
        roomInventoryMap[r.id] = r.inventory;
        return sum + r.inventory;
      }, 0);

      if (totalInventory > 0) {
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
          select: { checkIn: true, checkOut: true, roomSelections: true },
        });

        // Build a map: date -> total booked rooms across all types
        const dateBookedMap: Record<string, number> = {};
        bookings.forEach((booking) => {
          if (!booking.checkIn || !booking.checkOut) return;
          const selections = booking.roomSelections as Record<string, number> | null;
          if (!selections) return;
          const totalBooked = Object.values(selections).reduce((sum, qty) => sum + qty, 0);
          const current = new Date(booking.checkIn);
          const end = new Date(booking.checkOut);
          while (current < end) {
            const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
            dateBookedMap[dateStr] = (dateBookedMap[dateStr] || 0) + totalBooked;
            current.setDate(current.getDate() + 1);
          }
        });

        // Only mark as booked if total booked >= total available inventory
        bookedDates = Object.entries(dateBookedMap)
          .filter(([, qty]) => qty >= totalInventory)
          .map(([date]) => date);
      }
    }

    // Deduplicate bookedDates
    bookedDates = [...new Set(bookedDates)];

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