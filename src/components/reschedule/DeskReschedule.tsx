"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, MessageCircle, MessageSquare, MoveRight, Sparkles, X, Zap } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";
import { earlierSlotMessage, rescheduleOffersMessage, rescheduledMessage, smsLink, whatsappLink } from "@/lib/notify";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { formatClock, formatShortDateTime, localDateString } from "@/lib/time";
import type { RescheduleReason } from "@/lib/types/database";
import type { ApiError, Barber, BookingContact, LiveAppointment, Shift, ShopSettings } from "@/lib/types/domain";
import { Button } from "../ui/primitives";
import { RescheduleSlotPicker } from "./RescheduleSlotPicker";

export interface MovedBooking {
  appointmentId: string;
  customerName: string;
  phone: string | null;
  passUrl: string | null;
  startsAt: string;
  barberName: string;
}

interface Offer {
  id: string;
  starts_at: string;
  ends_at: string;
  barber_id: string;
  expires_at: string;
}

const DESK_ERRORS: Record<string, string> = {
  slot_unavailable: "That time was just taken — pick another.",
  offer_expired: "That held time expired — propose again.",
  invalid_transition: "This booking can't be moved any more.",
  forbidden: "Staff access only.",
  barber_unavailable: "That barber isn't active.",
};

/**
 * Desk-side reschedule (EZ-002 / EZ-011):
 * - "Propose times": the server ranks free times and holds them for the
 *   customer; the host sends them with a tap-to-send WhatsApp/SMS link.
 * - "Move now": apply a held time directly (customer agreed in person/phone).
 * - "Pick a time": move to any free time.
 */
export function DeskReschedule({
  appt,
  contact,
  barbers,
  settings,
  shifts,
  origin,
  reason,
  emphasis = false,
  onChanged,
  onMoved,
}: {
  appt: LiveAppointment;
  contact: BookingContact | undefined;
  barbers: Barber[];
  settings: ShopSettings;
  shifts: Shift[];
  origin: string;
  reason: RescheduleReason;
  emphasis?: boolean;
  onChanged: () => void;
  /** Called after a successful move so the board can keep a confirmation visible
   *  even when this row disappears (e.g. the booking is no longer delayed). */
  onMoved?: (moved: MovedBooking) => void;
}) {
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ startsAt: string; barberId: string } | null>(null);
  const barberName = (id: string) => barbers.find((b) => b.id === id)?.displayName ?? "barber";
  const passUrl = contact ? `${origin}/pass/${contact.accessToken}` : "";
  const isEarly = reason === "early";

  async function propose() {
    setBusy("propose");
    setError(null);
    try {
      const res = await fetch("/api/desk/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: appt.id, reason, limit: isEarly ? 1 : 3 }),
      });
      const body = (await res.json()) as { offers?: Offer[] } & Partial<ApiError>;
      if (!res.ok) {
        setError(body.message ?? "Couldn't propose times.");
        return;
      }
      setOffers(body.offers ?? []);
      if ((body.offers ?? []).length === 0) {
        setError(isEarly ? "No earlier slot fits before this booking." : "No free times found in the next week.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function move(startsAt: string | null, barberId: string | null, offerId: string | null, key: string) {
    setBusy(key);
    setError(null);
    const { data, error: rpcError } = await getBrowserSupabase().rpc("desk_reschedule", {
      p_appointment_id: appt.id,
      p_starts_at: startsAt,
      p_barber_id: barberId,
      p_offer_id: offerId,
    });
    setBusy(null);
    if (rpcError) {
      setError(DESK_ERRORS[rpcError.message] ?? `Couldn't move (${rpcError.message}).`);
      return;
    }
    const result = data as { starts_at?: string; barber_id?: string } | null;
    const next = { startsAt: result?.starts_at ?? startsAt ?? appt.startsAt, barberId: result?.barber_id ?? barberId ?? appt.barberId };
    setMoved(next);
    onMoved?.({
      appointmentId: appt.id,
      customerName: contact?.customerName ?? appt.displayName,
      phone: contact?.phone ?? null,
      passUrl: passUrl || null,
      startsAt: next.startsAt,
      barberName: barberName(next.barberId),
    });
    setOffers(null);
    setPicking(false);
    onChanged();
  }

  const offerLines = (offers ?? []).map((o) => `${formatShortDateTime(o.starts_at, settings.timezone)} with ${barberName(o.barber_id)}`);
  const offerMessage =
    contact && offers && offers.length > 0
      ? isEarly
        ? earlierSlotMessage({
            shopName: settings.shopName,
            customerName: contact.customerName,
            barberName: barberName(offers[0]!.barber_id),
            newTime: formatClock(offers[0]!.starts_at, settings.timezone),
            bookedTime: formatClock(appt.startsAt, settings.timezone),
            passUrl,
          })
        : rescheduleOffersMessage({
            shopName: settings.shopName,
            customerName: contact.customerName,
            reason,
            options: offerLines,
            holdUntil: formatShortDateTime(offers[0]!.expires_at, settings.timezone),
            passUrl,
          })
      : "";

  if (!open) {
    return (
      <Button
        size="sm"
        variant={emphasis ? "primary" : "secondary"}
        onClick={() => {
          setOpen(true);
          if (isEarly) void propose();
        }}
      >
        {isEarly ? <Zap className="size-4" /> : <CalendarClock className="size-4" />}
        {isEarly ? "Offer earlier slot" : "Reschedule"}
      </Button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full space-y-3 rounded-2xl border border-amber-500/40 glass-inset p-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-100">
          {isEarly ? "Earlier slot" : "Reschedule"} · {contact?.customerName ?? appt.displayName}
        </p>
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200">
          <X className="size-4" />
        </button>
      </div>

      <AnimatePresence>
        {moved && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <p>
              Moved to {formatShortDateTime(moved.startsAt, settings.timezone)} with {barberName(moved.barberId)}.
            </p>
            {contact && (
              <a
                href={whatsappLink(
                  contact.phone,
                  rescheduledMessage({
                    shopName: settings.shopName,
                    customerName: contact.customerName,
                    barberName: barberName(moved.barberId),
                    newTime: formatShortDateTime(moved.startsAt, settings.timezone),
                    passUrl,
                  }),
                )}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-zinc-950"
              >
                <MessageCircle className="size-4" /> Send confirmation
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!moved && !isEarly && offers === null && !picking && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy === "propose"} onClick={() => void propose()}>
            <Sparkles className="size-4" /> Propose 3 times
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            <CalendarClock className="size-4" /> Pick a time
          </Button>
        </div>
      )}

      {busy === "propose" && isEarly && <p className="text-sm text-zinc-400">Finding an earlier slot…</p>}

      {offers && offers.length > 0 && !moved && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            Held for the customer until {formatShortDateTime(offers[0]!.expires_at, settings.timezone)}. Send them, or move now if
            they already agreed.
          </p>
          {offers.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-xl border border-white/10 p-2">
              <span className="min-w-0 flex-1 font-mono text-sm text-zinc-100">
                {formatShortDateTime(o.starts_at, settings.timezone)}
                <span className="font-sans text-zinc-500"> · {barberName(o.barber_id)}</span>
              </span>
              <Button size="sm" variant="secondary" loading={busy === o.id} onClick={() => void move(null, null, o.id, o.id)}>
                <MoveRight className="size-4" /> Move now
              </Button>
            </div>
          ))}
          {contact && (
            <div className="flex gap-2">
              <a
                href={whatsappLink(contact.phone, offerMessage)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
              >
                <MessageCircle className="size-4" /> Send via WhatsApp
              </a>
              <a
                href={smsLink(contact.phone, offerMessage)}
                className="inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-zinc-300"
                aria-label="Send via SMS"
              >
                <MessageSquare className="size-4" />
              </a>
            </div>
          )}
        </div>
      )}

      {picking && !moved && (
        <RescheduleSlotPicker
          settings={settings}
          shifts={shifts}
          barbers={barbers}
          serviceIds={appt.serviceIds}
          addonIds={appt.addonIds}
          durationMin={appt.durationMin}
          originalBarberId={appt.barberId}
          ignoreAppointmentId={appt.id}
          initialDate={localDateString(new Date(appt.startsAt), settings.timezone)}
          busy={busy === "pick"}
          onConfirm={(slot, barberId) => void move(slot.startsAt, barberId, null, "pick")}
        />
      )}

      {error && <p className={cn("text-sm", offers && offers.length === 0 ? "text-amber-200" : "text-rose-300")}>{error}</p>}
    </motion.div>
  );
}
