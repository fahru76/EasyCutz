import "server-only";

import { z } from "zod";
import { MAX_ADDONS, MAX_SERVICES } from "@/lib/cart";
import { isDateString } from "@/lib/time";
import { normalizePhone } from "@/lib/format";
import { AppError } from "./errors";

const uuid = z.uuid();

const customerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  phone: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const e164 = normalizePhone(value);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
        return z.NEVER;
      }
      return e164;
    }),
  email: z
    .union([z.literal(""), z.email("Enter a valid email")])
    .optional()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
});

const baseBooking = {
  serviceIds: z.array(uuid).min(1, "Pick at least one service").max(MAX_SERVICES),
  addonIds: z.array(uuid).max(MAX_ADDONS).default([]),
  barberId: uuid.nullable(),
  paymentOption: z.enum(["cash_on_site", "deposit", "full"]),
  customer: customerSchema,
};

export const createBookingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("scheduled"), startsAt: z.iso.datetime({ offset: true }), ...baseBooking }),
  z.object({ mode: z.literal("walk_in"), ...baseBooking }),
]);
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const availabilityQuerySchema = z.object({
  date: z.string().refine(isDateString, "date must be YYYY-MM-DD"),
  barber: z.union([z.literal("any"), uuid]),
  services: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(uuid).min(1).max(MAX_SERVICES)),
  addons: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(uuid).max(MAX_ADDONS)),
  /** EZ-002: when moving a booking, ignore that booking (and its own offers) as "busy". */
  ignore: uuid.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const tokenSchema = uuid;

export const customerRescheduleSchema = z.union([
  z.object({ offerId: uuid }),
  z.object({ startsAt: z.iso.datetime({ offset: true }), barberId: uuid.nullable() }),
]);

export const deskProposalSchema = z.object({
  appointmentId: uuid,
  reason: z.enum(["delay", "closure", "barber_unavailable", "early", "manual"]),
  limit: z.number().int().min(1).max(5).optional(),
});

export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new AppError("invalid_request", 400, `${where}${first?.message ?? "Invalid request"}`);
  }
  return result.data;
}
