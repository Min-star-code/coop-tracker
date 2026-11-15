import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * One place that turns errors into JSON responses.
 * - ZodError (bad input)            -> 400 with the field problems
 * - HttpError                       -> its own status
 * - Postgres 23505 unique violation -> 409 (e.g. same WaterlooWorks job id twice)
 * - Postgres 23514 check violation  -> 400 (the database refused a bad value)
 * - anything else                   -> 500, details only in the server log
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "invalid input",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  } else if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (err?.code === "23505") {
    res.status(409).json({ error: "already exists" });
  } else if (err?.code === "23514") {
    res.status(400).json({ error: "value not allowed" });
  } else if (err?.type === "entity.too.large") {
    // Body over the route's size limit: say so, instead of a generic 500.
    res.status(413).json({ error: "request body too large" });
  } else if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "body is not valid JSON" });
  } else {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  }
};
