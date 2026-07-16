import type { Request, Response, NextFunction } from "express";
import * as templateService from "../services/template.service.js";

// @desc    Get all campaign templates
// @route   GET /api/admin/templates
// @access  Private (Admin)
export const listTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const templates = await templateService.listTemplates();
    res.status(200).json({
      status: "success",
      results: templates.length,
      data: { templates },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a campaign template
// @route   POST /api/admin/templates
// @access  Private (Admin)
export const createTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, type, subject, body } = req.body;
    const template = await templateService.createTemplate({ name, type, subject, body });
    res.status(201).json({
      status: "success",
      message: "Template created successfully.",
      data: { template },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a campaign template
// @route   PUT /api/admin/templates/:id
// @access  Private (Admin)
export const updateTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, type, subject, body } = req.body;
    const template = await templateService.updateTemplate(req.params.id as string, { name, type, subject, body });
    res.status(200).json({
      status: "success",
      message: "Template updated successfully.",
      data: { template },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a campaign template
// @route   DELETE /api/admin/templates/:id
// @access  Private (Admin)
export const deleteTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await templateService.deleteTemplate(req.params.id as string);
    res.status(200).json({
      status: "success",
      message: "Template deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};
