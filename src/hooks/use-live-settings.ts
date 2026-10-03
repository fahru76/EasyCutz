"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { mapSettings, type ShopSettings } from "@/lib/types/domain";

/**
 * Shop settings kept current through Realtime (EZ-001: closure state; EZ-009:
 * rules). Used where the full live catalog isn't needed (desk, pass).
 */
export function useLiveSettings(initial: ShopSettings, channelName = "easycutz-settings"): ShopSettings {
  const [settings, setSettings] = useState<ShopSettings>(initial);

  useEffect(() => {
    const db = getBrowserSupabase();
    let cancelled = false;
    const reload = async () => {
      const { data, error } = await db.from("shop_settings").select("*").eq("id", 1).maybeSingle();
      if (!cancelled && !error && data) setSettings(mapSettings(data));
    };
    const channel = db
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_settings" }, () => void reload())
      .subscribe((state) => {
        if (state === "SUBSCRIBED") void reload();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void db.removeChannel(channel);
    };
  }, [channelName]);

  return settings;
}
