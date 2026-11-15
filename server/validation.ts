import { z } from "zod";

export const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Ranked", "Rejected", "Skipped"] as const;
export const SOURCES = ["waterlooworks", "company_site", "linkedin", "referral", "other"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalDate = z.iso.date().nullable().optional(); // "YYYY-MM-DD"

/** Columns a client may write. Anything else in the body is ignored, never trusted. */
const fields = {
  source: z.enum(SOURCES),
  ww_job_id: z.string().trim().regex(/^\d+$/, "must be digits").nullable().optional(),
  company: text(200),
  title: text(300),
  url: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
  status: z.enum(STATUSES),
  applied_on: optionalDate,
  deadline: optionalDate,
  note: z.string().max(5000).nullable().optional(),
};

export const createApplication = z
  .object({ ...fields, status: fields.status.default("Saved") })
  .refine((a) => a.source === "waterlooworks" || !a.ww_job_id, {
    message: "ww_job_id is only allowed when source is waterlooworks",
    path: ["ww_job_id"],
  });

export const updateApplication = z
  .object(fields)
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

export type CreateApplication = z.infer<typeof createApplication>;
export type UpdateApplication = z.infer<typeof updateApplication>;
