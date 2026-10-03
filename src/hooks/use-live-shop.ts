"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { localDateString, localDayBounds } from "@/lib/time";
import {
  mapAppointment,
  mapBarber,
  mapTicket,
  type Barber,
  type LiveAppointment,
  type LiveTicket,
} from "@/lib/types/domain";

export type LiveStatus = "connecting" | "live" | "offline";

export interface LiveShop {
  barbers: Barber[];
  tickets: LiveTicket[];
  appointments: LiveAppointment[];
  status: LiveStatus;
  lastUpdated: Date | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const REFETCH_DEBOUNCE_MS = 250;
const SAFETY_POLL_MS = 60_000;
const OFFLINE_POLL_MS = 15_000;

/**
 * Today's live queue + bookings + roster, kept current by Supabase Realtime
 * (postgres_changes on queue_tickets, appointments and barbers).
 *
 * Any change triggers a debounced refetch of the day's snapshot, which keeps
 * ordering and RLS semantics identical to the initial load and self-heals
 * after missed events. A slow safety poll covers flaky mobile connections.
 */
export function useLiveShop(options: { initialBarbers: Barber[]; timezone: string; channelName?: string }): LiveShop {
  const { initialBarbers, timezone, channelName = "easycutz-live" } = options;
  const [barbers, setBarbers] = useState<Barber[]>(initialBarbers);
  const [tickets, setTickets] = useState<LiveTicket[]>([]);
  const [appointments, setAppointments] = useState<LiveAppointment[]>([]);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      const db = getBrowserSupabase();
      const today = localDateString(new Date(), timezone);
      const { start, end } = localDayBounds(today, timezone);
      const [b, t, a] = await Promise.all([
        db.from("barbers").select("*").eq("is_active", true).order("sort_order"),
        db.from("queue_tickets").select("*").eq("shop_day", today).order("ticket_number"),
        db
          .from("appointments")
          .select("*")
          .gte("starts_at", start.toISOString())
          .lt("starts_at", end.toISOString())
          .order("starts_at"),
      ]);
      const firstError = b.error ?? t.error ?? a.error;
      if (firstError) {
        setError(firstError.message);
        return;
      }
      setError(null);
      setBarbers((b.data ?? []).map(mapBarber));
      setTickets((t.data ?? []).map(mapTicket));
      setAppointments((a.data ?? []).map(mapAppointment));
      setLastUpdated(new Date());
    })();
    inflight.current = run;
    try {
      await run;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      inflight.current = null;
    }
  }, [timezone]);

  const scheduleRefresh = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void refresh();
    }, REFETCH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    const db = getBrowserSupabase();
    void refresh();

    const channel = db
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "barbers" }, scheduleRefresh)
      .subscribe((state) => {
        if (state === "SUBSCRIBED") {
          setStatus("live");
          scheduleRefresh(); // catch anything that changed while connecting
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          setStatus("offline");
        }
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", scheduleRefresh);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", scheduleRefresh);
      if (timer.current !== null) window.clearTimeout(timer.current);
      void db.removeChannel(channel);
    };
  }, [channelName, refresh, scheduleRefresh]);

  // Safety poll: slow when realtime is healthy, faster when it isn't.
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), status === "live" ? SAFETY_POLL_MS : OFFLINE_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh, status]);

  return { barbers, tickets, appointments, status, lastUpdated, error, refresh };
}
