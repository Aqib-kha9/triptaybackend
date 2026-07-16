import { prisma } from "../config/db.js";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../core/logger.js";

// ─── Audit Log Interface ───
export interface AuditLogInput {
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  category?: string;
  resource?: string;
  resourceId?: string;
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

// ─── Create an audit log entry ───
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const logEntry = await prisma.auditLog.create({
      data: {
        actorId: input.actorId || null,
        actorEmail: input.actorEmail || null,
        actorRole: input.actorRole || null,
        action: input.action,
        category: input.category || "general",
        resource: input.resource || null,
        resourceId: input.resourceId || null,
        method: input.method || null,
        path: input.path || null,
        ip: input.ip || null,
        userAgent: input.userAgent || null,
        statusCode: input.statusCode || null,
        details: (input.details ?? undefined) as any,
      },
    });

    try {
      const { emitToAdmins } = await import("../socket/emitter.js");
      emitToAdmins("audit:new_log", logEntry);
    } catch (sockErr) {
      // Ignore
    }
  } catch (err) {
    // Audit logging should never break the request flow
    logger.error("Failed to create audit log:", err);
  }
}

// ─── Express middleware: logs all API requests ───
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip health checks and GET requests to public browse endpoints
  if (req.path === "/api/health") {
    return next();
  }

  const startTime = Date.now();

  // Capture the response after it's sent
  const originalEnd = res.end.bind(res);
  (res as any).end = function (...args: unknown[]) {
    // Determine actor from req.user (set by protect middleware)
    const user = (req as any).user;
    const admin = (req as any).admin;

    const actorId = admin?.id || user?.id || null;
    const actorEmail = admin?.email || user?.email || null;
    const actorRole = admin?.role || user?.role || null;

    // Determine category from path
    let category = "general";
    if (req.path.startsWith("/api/auth")) category = "auth";
    else if (req.path.startsWith("/api/admin")) category = "admin";
    else if (req.path.startsWith("/api/listings")) category = "listing";
    else if (req.path.startsWith("/api/activities")) category = "activity";
    else if (req.path.startsWith("/api/bookings")) category = "booking";
    else if (req.path.startsWith("/api/payments")) category = "payment";
    else if (req.path.startsWith("/api/coupons")) category = "payment";

    // Determine action from method + path
    const method = req.method;
    let action = `${method}_${category.toUpperCase()}`;
    if (method === "POST" && req.path.includes("login")) action = "USER_LOGIN";
    else if (method === "POST" && req.path.includes("logout")) action = "USER_LOGOUT";
    else if (method === "POST" && req.path.includes("signup")) action = "USER_SIGNUP";
    else if (method === "POST" && req.path.includes("register")) action = "USER_REGISTER";
    else if (method === "POST" && req.path.includes("approve")) action = "APPROVE";
    else if (method === "POST" && req.path.includes("reject")) action = "REJECT";
    else if (method === "PATCH" && req.path.includes("status")) action = "STATUS_CHANGE";
    else if (method === "DELETE") action = "DELETE";

    // Only log write operations and important reads (skip GET for performance)
    if (method === "GET" && !req.path.includes("export") && !req.path.includes("audit")) {
      // Skip logging for most GET requests
    } else {
      createAuditLog({
        actorId,
        actorEmail,
        actorRole,
        action,
        category,
        method,
        path: req.path,
        ip: req.ip || req.socket.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
        statusCode: res.statusCode,
        details: method !== "GET" ? { body: sanitizeBody(req.body) } : undefined,
      }).catch(() => {});
    }

    (originalEnd as any)(...args);
  };

  next();
}

// ─── Sanitize body for logging (remove sensitive fields) ───
function sanitizeBody(body: any): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const sanitized: Record<string, unknown> = {};
  const sensitiveFields = ["password", "currentPassword", "newPassword", "token", "secret", "code"];

  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ─── Query audit logs (for admin viewer) ───
export async function queryAuditLogs(params: {
  page?: number;
  limit?: number;
  actorId?: string;
  action?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const page = params.page || 1;
  const limit = Math.min(params.limit || 50, 200);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (params.actorId) where.actorId = params.actorId;
  if (params.action) where.action = { contains: params.action, mode: "insensitive" };
  if (params.category) where.category = params.category;
  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) (where.createdAt as any).gte = params.startDate;
    if (params.endDate) (where.createdAt as any).lte = params.endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Archive old audit logs to S3 (for cron job) ───
export async function archiveOldAuditLogs(daysOld: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

  const oldLogs = await prisma.auditLog.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
  });

  if (oldLogs.length === 0) return 0;

  // In production, this would upload to S3 as a JSON archive
  // For now, we just delete them after the retention period
  logger.info(`Archiving ${oldLogs.length} audit logs older than ${daysOld} days.`);

  await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return oldLogs.length;
}

export default {
  createAuditLog,
  auditMiddleware,
  queryAuditLogs,
  archiveOldAuditLogs,
};
