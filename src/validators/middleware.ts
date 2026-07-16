import type { Request, Response, NextFunction } from "express";
import type { ZodSchema, ZodError } from "zod";
import { BadRequestError } from "../core/errors.js";

/**
 * Middleware factory that validates request body/query/params
 * against a Zod schema. Throws BadRequestError with formatted
 * validation messages on failure.
 */
export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const errors = (result.error as ZodError).errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      const message = errors
        .map((e) => `${e.field}: ${e.message}`)
        .join("; ");
      return next(new BadRequestError(message));
    }
    // Replace with parsed (and potentially transformed) data
    req[source] = result.data;
    next();
  };
}

/**
 * Creates a middleware that validates multiple sources at once.
 */
export function validateMulti(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);
        if (!result.success) throw result.error;
        req.body = result.data;
      }
      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        if (!result.success) throw result.error;
        (req as any).query = result.data;
      }
      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (!result.success) throw result.error;
        req.params = result.data as Record<string, string>;
      }
      next();
    } catch (error: any) {
      if (error?.errors) {
        const messages = error.errors
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return next(new BadRequestError(messages));
      }
      next(error);
    }
  };
}