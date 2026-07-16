import type { Response } from "express";

/**
 * Standardized API response helpers.
 * Ensures all responses follow a consistent format:
 * { status: "success"|"fail", data?: any, message?: string, pagination?: {...} }
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  status: "success" | "fail";
  data?: T;
  message?: string;
  pagination?: PaginationMeta;
  results?: number;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  pagination?: PaginationMeta,
): void {
  const body: ApiResponse<T> = { status: "success", data };
  if (pagination) body.pagination = pagination;
  if (Array.isArray(data)) body.results = data.length;
  res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, 201);
}

export function sendFail(res: Response, statusCode: number, message: string): void {
  res.status(statusCode).json({ status: "fail", message });
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: PaginationMeta,
): void {
  sendSuccess(res, data, 200, pagination);
}