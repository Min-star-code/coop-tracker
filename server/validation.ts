import { z } from "zod";

export const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Ranked", "Rejected", "Skipped"] as const;
export const SOURCES = ["waterlooworks", "company_site", "linkedin", "referral", "other"] as const;
export type Status = (typeof STATUSES)[number];

const optionalDate = z.iso.date().nullable().optional(); // "YYYY-MM-DD"

/**
 * What the owner may change on the website. Company, title, source and ids come only from the
 * sync agent; the owner adjusts progress (e.g. got an interview) and notes.
 * Anything else in the body is dropped, never trusted.
 */
export const updateApplication = z
  .object({
    status: z.enum(STATUSES),
    note: z.string().max(5000).nullable(),
    deadline: optionalDate,
    applied_on: optionalDate,
  })
  .partial()
  .refine((a) => Object.keys(a).length > 0, { message: "nothing to update" });

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)));

export const listQuery = z.object({
  status: csv(STATUSES).optional(),
  source: csv(SOURCES).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["updated", "deadline", "company"]).default("updated"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const deadlineQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(14),
});

export type UpdateApplication = z.infer<typeof updateApplication>;
