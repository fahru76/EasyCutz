"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { mapAddon, mapService, mapSettings, type Addon, type Service, type ShopSettings } from "@/lib/types/domain";

export interface LiveCatalog {
  settings: ShopSettings;
  services: Service[];
  addons: Addon[];
}

/**
 * Keeps the menu, prices and shop rules current while a customer is on the
 * page (EZ-009). Owner edits arrive through Supabase Realtime; the database
 * still re-prices every booking on submit, so this is purely for display.
 */
export function useLiveCatalog(initial: LiveCatalog): LiveCatalog {
  const [catalog, setCatalog] = useState<LiveCatalog>(initial);

  useEffect(() => {
    const db = getBrowserSupabase();
    let timer: number | null = null;

    const reload = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        timer = null;
        const [settings, services, addons] = await Promise.all([
          db.from("shop_settings").select("*").eq("id", 1).maybeSingle(),
          db.from("services").select("*").eq("is_active", true).order("sort_order").order("name"),
          db.from("addons").select("*").eq("is_active", true).order("sort_order").order("name"),
        ]);
        if (settings.error || services.error || addons.error || !settings.data) return;
        setCatalog({
          settings: mapSettings(settings.data),
          services: (services.data ?? []).map(mapService),
          addons: (addons.data ?? []).map(mapAddon),
        });
      }, 300);
    };

    const channel = db
      .channel("easycutz-catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "services" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "addons" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_settings" }, reload)
      .subscribe();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, []);

  return catalog;
}
