import { prisma } from "../config/db.js";
import {
  BadRequestError,
  NotFoundError,
} from "../core/errors.js";
import { logger } from "../core/logger.js";
import { createAuditLog } from "./audit.service.js";
import { cacheDelPattern } from "../config/redis.js";
import { sendBulkEmails } from "./email.service.js";
import { sendWhatsAppText } from "./whatsapp.service.js";
import { sendPushToUser } from "./push.service.js";

// ─── Types ───
export interface CreateCampaignInput {
  name: string;
  type: string; // email | whatsapp | push | multi
  subject?: string;
  content: string;
  htmlContent?: string;
  targetSegment?: string; // all | guests | hosts | custom
  scheduledAt?: string;
  status?: string; // draft | scheduled | running | completed | paused
}

export interface CampaignListQuery {
  page?: string;
  limit?: string;
  status?: string;
  type?: string;
}

function resolvePagination(pageStr?: string, limitStr?: string, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitStr || String(defaultLimit), 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── Resolve audience based on segment ───
async function resolveAudience(segment: string): Promise<{ userIds: string[]; emails: string[]; phones: string[] }> {
  let where: Record<string, unknown> = { status: "active" };

  switch (segment) {
    case "guests":
      where = { ...where, role: { in: ["Guest", "Dual Mode"] } };
      break;
    case "hosts":
      where = { ...where, role: { in: ["Vendor", "Dual Mode"] } };
      break;
    case "all":
    default:
      break;
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, phone: true },
  });

  return {
    userIds: users.map((u) => u.id),
    emails: users.map((u) => u.email).filter((e): e is string => Boolean(e)),
    phones: users.map((u) => u.phone).filter((p): p is string => Boolean(p)),
  };
}

// ─── Create a campaign (admin) ───
export async function createCampaign(data: CreateCampaignInput, adminId: string) {
  const campaign = await prisma.campaign.create({
    data: {
      name: data.name,
      type: data.type,
      subject: data.subject || null,
      body: data.content,
      audience: data.targetSegment || "all",
      status: data.status || "draft",
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      createdBy: adminId,
    },
  });

  await createAuditLog({
    action: "CAMPAIGN_CREATE",
    actorId: adminId,
    resource: "campaign",
    resourceId: campaign.id,
    category: "campaign",
    details: {
      name: campaign.name,
      type: campaign.type,
      status: campaign.status,
    },
  });

  await cacheDelPattern("admin:campaigns:*");

  logger.info(`Campaign ${campaign.id} (${campaign.name}) created by admin ${adminId}`);

  return campaign;
}

// ─── List all campaigns (admin) ───
export async function listAllCampaigns(query: CampaignListQuery) {
  const { page, limit, skip } = resolvePagination(query.page, query.limit);

  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.campaign.count({ where }),
  ]);

  return {
    campaigns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get campaign detail (admin) ───
export async function getCampaignDetail(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found.");
  }
  return campaign;
}

// ─── Update a campaign (admin) ───
export async function updateCampaign(campaignId: string, data: Partial<CreateCampaignInput>, adminId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found.");
  }

  if (campaign.status === "running" || campaign.status === "completed") {
    throw new BadRequestError(`Cannot modify a campaign that is ${campaign.status}.`);
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.subject !== undefined) updateData.subject = data.subject;
  if (data.content !== undefined) updateData.body = data.content;
  if (data.targetSegment !== undefined) updateData.audience = data.targetSegment;
  if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
  if (data.status !== undefined) updateData.status = data.status;

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: updateData,
  });

  await createAuditLog({
    action: "CAMPAIGN_UPDATE",
    actorId: adminId,
    resource: "campaign",
    resourceId: campaign.id,
    category: "campaign",
    details: { updatedFields: Object.keys(updateData) },
  });

  await cacheDelPattern("admin:campaigns:*");

  return updated;
}

// ─── Delete a campaign (admin) ───
export async function deleteCampaign(campaignId: string, adminId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found.");
  }

  if (campaign.status === "running") {
    throw new BadRequestError("Cannot delete a running campaign. Pause it first.");
  }

  await prisma.campaign.delete({ where: { id: campaignId } });

  await createAuditLog({
    action: "CAMPAIGN_DELETE",
    actorId: adminId,
    resource: "campaign",
    resourceId: campaignId,
    category: "campaign",
    details: { name: campaign.name },
  });

  await cacheDelPattern("admin:campaigns:*");

  logger.info(`Campaign ${campaignId} deleted by admin ${adminId}`);
}

// ─── Execute a campaign (send to audience) ───
export async function executeCampaign(campaignId: string, adminId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found.");
  }

  if (campaign.status === "running") {
    throw new BadRequestError("Campaign is already running.");
  }
  if (campaign.status === "completed") {
    throw new BadRequestError("Campaign has already been completed.");
  }

  // Mark as running
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    const { emitToAdmins } = await import("../socket/emitter.js");
    emitToAdmins("campaign:stats_update", {
      campaignId,
      status: "running",
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
    });
  } catch (err: any) {
    logger.error("Failed to emit campaign stats update socket event:", err.message);
  }

  // Resolve audience
  const audience = await resolveAudience(campaign.audience);

  let totalSent = 0;
  let totalDelivered = 0;
  let totalFailed = 0;

  try {
    if (campaign.type === "email" || campaign.type === "multi") {
      if (audience.emails.length > 0) {
        const result = await sendBulkEmails(
          audience.emails,
          campaign.subject || campaign.name,
          campaign.body,
        );
        totalSent += result.sent + result.failed;
        totalDelivered += result.sent;
        totalFailed += result.failed;
      }
    }

    if (campaign.type === "whatsapp" || campaign.type === "multi") {
      // Send WhatsApp messages
      for (const phone of audience.phones) {
        try {
          await sendWhatsAppText({
            to: phone,
            body: campaign.body,
          });
          totalSent++;
          totalDelivered++;
        } catch {
          totalSent++;
          totalFailed++;
        }
      }
    }

    if (campaign.type === "push" || campaign.type === "multi") {
      // Send push notifications
      for (const userId of audience.userIds) {
        try {
          await sendPushToUser(userId, {
            title: campaign.subject || campaign.name,
            body: campaign.body.substring(0, 200),
          });
          totalSent++;
          totalDelivered++;
        } catch {
          totalSent++;
          totalFailed++;
        }
      }
    }

    // Mark as completed
    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "completed",
        totalSent,
        totalDelivered,
        totalFailed,
        completedAt: new Date(),
      },
    });

    await createAuditLog({
      action: "CAMPAIGN_EXECUTE",
      actorId: adminId,
      resource: "campaign",
      resourceId: campaign.id,
      category: "campaign",
      details: {
        name: campaign.name,
        type: campaign.type,
        totalSent,
        totalDelivered,
        totalFailed,
      },
    });

    await cacheDelPattern("admin:campaigns:*");

    logger.info(`Campaign ${campaign.id} executed: ${totalSent} sent, ${totalDelivered} delivered, ${totalFailed} failed`);

    try {
      const { emitToAdmins } = await import("../socket/emitter.js");
      emitToAdmins("campaign:stats_update", {
        campaignId,
        status: "completed",
        totalSent,
        totalDelivered,
        totalFailed,
      });
    } catch (sockErr) {
      // Ignore
    }

    return updated;
  } catch (err: any) {
    // Mark as failed but keep stats
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "completed",
        totalSent,
        totalDelivered,
        totalFailed,
        completedAt: new Date(),
      },
    });

    try {
      const { emitToAdmins } = await import("../socket/emitter.js");
      emitToAdmins("campaign:stats_update", {
        campaignId,
        status: "completed",
        totalSent,
        totalDelivered,
        totalFailed,
      });
    } catch (sockErr) {
      // Ignore
    }

    logger.error(`Campaign ${campaign.id} execution failed:`, err.message);
    throw err;
  }
}

// ─── Cancel/pause a campaign (admin) ───
export async function cancelCampaign(campaignId: string, adminId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found.");
  }

  if (campaign.status === "completed") {
    throw new BadRequestError("Cannot cancel a completed campaign.");
  }

  const updated = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "cancelled" },
  });

  await createAuditLog({
    action: "CAMPAIGN_CANCEL",
    actorId: adminId,
    resource: "campaign",
    resourceId: campaign.id,
    category: "campaign",
    details: { name: campaign.name },
  });

  await cacheDelPattern("admin:campaigns:*");

  logger.info(`Campaign ${campaign.id} cancelled by admin ${adminId}`);

  return updated;
}

// ─── Get campaign statistics (admin) ───
export async function getCampaignStats() {
  const [total, draft, scheduled, running, completed, cancelled] = await Promise.all([
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: "draft" } }),
    prisma.campaign.count({ where: { status: "scheduled" } }),
    prisma.campaign.count({ where: { status: "running" } }),
    prisma.campaign.count({ where: { status: "completed" } }),
    prisma.campaign.count({ where: { status: "cancelled" } }),
  ]);

  // Aggregate delivery stats
  const aggregate = await prisma.campaign.aggregate({
    _sum: {
      totalSent: true,
      totalDelivered: true,
      totalFailed: true,
    },
  });

  return {
    total,
    draft,
    scheduled,
    running,
    completed,
    cancelled,
    totalSent: aggregate._sum.totalSent || 0,
    totalDelivered: aggregate._sum.totalDelivered || 0,
    totalFailed: aggregate._sum.totalFailed || 0,
  };
}
