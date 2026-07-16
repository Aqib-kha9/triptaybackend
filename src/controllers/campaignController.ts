import type { Request, Response, NextFunction } from "express";
import * as campaignService from "../services/campaign.service.js";

// ──────────────────────── Controllers ────────────────────────

// @desc    Create a marketing campaign (admin)
// @route   POST /api/admin/campaigns
// @access  Private (Admin)
export const createCampaign = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, type, subject, content, htmlContent, targetSegment, scheduledAt, status } = req.body;
    const campaign = await campaignService.createCampaign(
      {
        name,
        type,
        subject,
        content,
        htmlContent,
        targetSegment,
        scheduledAt,
        status,
      },
      req.admin.id,
    );

    res.status(201).json({
      status: "success",
      message: "Campaign created successfully.",
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    List all campaigns (admin)
// @route   GET /api/admin/campaigns
// @access  Private (Admin)
export const listAllCampaigns = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, status, type } = req.query;
    const result = await campaignService.listAllCampaigns({
      page: page as string | undefined,
      limit: limit as string | undefined,
      status: status as string | undefined,
      type: type as string | undefined,
    });

    res.status(200).json({
      status: "success",
      results: result.campaigns.length,
      pagination: result.pagination,
      data: { campaigns: result.campaigns },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get campaign detail (admin)
// @route   GET /api/admin/campaigns/:campaignId
// @access  Private (Admin)
export const getCampaignDetail = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const campaign = await campaignService.getCampaignDetail(req.params.campaignId);

    res.status(200).json({
      status: "success",
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a campaign (admin)
// @route   PATCH /api/admin/campaigns/:campaignId
// @access  Private (Admin)
export const updateCampaign = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, type, subject, content, htmlContent, targetSegment, scheduledAt, status } = req.body;
    const campaign = await campaignService.updateCampaign(
      req.params.campaignId,
      {
        name,
        type,
        subject,
        content,
        htmlContent,
        targetSegment,
        scheduledAt,
        status,
      },
      req.admin.id,
    );

    res.status(200).json({
      status: "success",
      message: "Campaign updated successfully.",
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a campaign (admin)
// @route   DELETE /api/admin/campaigns/:campaignId
// @access  Private (Admin)
export const deleteCampaign = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    await campaignService.deleteCampaign(req.params.campaignId, req.admin.id);

    res.status(200).json({
      status: "success",
      message: "Campaign deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Execute / launch a campaign (admin)
// @route   POST /api/admin/campaigns/:campaignId/execute
// @access  Private (Admin)
export const executeCampaign = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const campaign = await campaignService.executeCampaign(req.params.campaignId, req.admin.id);

    res.status(200).json({
      status: "success",
      message: "Campaign executed successfully.",
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel / pause a campaign (admin)
// @route   POST /api/admin/campaigns/:campaignId/cancel
// @access  Private (Admin)
export const cancelCampaign = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const campaign = await campaignService.cancelCampaign(req.params.campaignId, req.admin.id);

    res.status(200).json({
      status: "success",
      message: "Campaign cancelled successfully.",
      data: { campaign },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get campaign statistics (admin dashboard)
// @route   GET /api/admin/campaigns/stats
// @access  Private (Admin)
export const getCampaignStats = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await campaignService.getCampaignStats();

    res.status(200).json({
      status: "success",
      data: { stats },
    });
  } catch (error) {
    next(error);
  }
};
