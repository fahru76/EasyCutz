import type { Dict } from "../../types";
import type { common as en } from "../en/common";

// Draft BM wording: every line marked TODO(review) waits for Fahru's approval (EZ-010).
export const common: Dict<typeof en> = {
  language: {
    label: "Bahasa",
    en: "EN",
    ms: "BM",
    enName: "English",
    msName: "Bahasa Melayu",
  },
  status: {
    live: "Langsung", // TODO(review)
    reconnecting: "Menyambung semula", // TODO(review)
    connecting: "Menyambung", // TODO(review)
    liveTitle: "Sambungan masa nyata aktif", // TODO(review)
    reconnectingTitle: "Menyambung semula…", // TODO(review)
  },
  time: {
    today: "Hari ini", // TODO(review)
    tomorrow: "Esok", // TODO(review)
  },
  units: {
    min: "{n} min", // TODO(review)
    hours: "{h}j", // TODO(review)
    hoursMinutes: "{h}j {m}m", // TODO(review)
  },
  wait: {
    now: "Sekarang", // TODO(review)
    approx: "~{duration}",
    noWait: "Tiada giliran", // TODO(review)
    minsWait: "~{n} min menunggu", // TODO(review)
    ahead: "{n} di hadapan", // TODO(review)
  },
  actions: {
    back: "Kembali", // TODO(review)
    continue: "Teruskan", // TODO(review)
    close: "Tutup", // TODO(review)
    dismiss: "Tutup", // TODO(review)
    tryAgain: "Cuba lagi", // TODO(review)
    cancel: "Batal", // TODO(review)
  },
  setup: {
    title: "Kedai sedang bersiap", // TODO(review)
    body: "Tempahan dalam talian tidak tersedia buat sementara. Sila cuba sebentar lagi.", // TODO(review)
  },
};
