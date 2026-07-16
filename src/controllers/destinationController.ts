import type { Response, NextFunction } from "express";
import * as destinationService from "../services/destination.service.js";

// ──────────────────────── Public Controllers ────────────────────────

// @desc    Get all destinations (public)
// @route   GET /api/destinations
// @access  Public
export const getAllDestinations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, category } = req.query;
    const result = await destinationService.getAllDestinations(page, limit, category);

    res.status(200).json({
      status: "success",
      results: result.destinations.length,
      pagination: result.pagination,
      data: {
        destinations: result.destinations,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single destination by slug (public)
// @route   GET /api/destinations/:slug
// @access  Public
export const getDestination = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await destinationService.getDestination(req.params.slug);

    res.status(200).json({
      status: "success",
      data: { destination: result.destination },
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────── Admin Controllers ────────────────────────

// @desc    Create destination (admin)
// @route   POST /api/admin/destinations
// @access  Private (Admin)
export const createDestination = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await destinationService.createDestination(req.body);

    res.status(201).json({
      status: "success",
      message: "Destination created successfully.",
      data: { destination: result.destination },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update destination (admin)
// @route   PATCH /api/admin/destinations/:id
// @access  Private (Admin)
export const updateDestination = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await destinationService.updateDestination(req.params.id, req.body);

    res.status(200).json({
      status: "success",
      message: "Destination updated successfully.",
      data: { destination: result.destination },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete destination (admin)
// @route   DELETE /api/admin/destinations/:id
// @access  Private (Admin)
export const deleteDestination = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await destinationService.deleteDestination(req.params.id);

    res.status(200).json({
      status: "success",
      message: "Destination deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Admin list destinations
// @route   GET /api/admin/destinations
// @access  Private (Admin)
export const adminListDestinations = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, category, includeInactive } = req.query;
    const result = await destinationService.adminListDestinations(
      page,
      limit,
      category,
      includeInactive === "true",
    );

    res.status(200).json({
      status: "success",
      results: result.destinations.length,
      pagination: result.pagination,
      data: {
        destinations: result.destinations,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload destination image (admin)
// @route   POST /api/admin/destinations/:id/image
// @access  Private (Admin)
export const uploadDestinationImage = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await destinationService.updateDestination(req.params.id, {
      image: (req as any).fileUrl || req.body.image,
    });

    res.status(200).json({
      status: "success",
      message: "Destination image uploaded successfully.",
      data: { destination: result.destination },
    });
  } catch (error) {
    next(error);
  }
};