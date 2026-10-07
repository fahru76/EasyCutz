export const common = {
  language: {
    label: "Language",
    en: "EN",
    ms: "BM",
    enName: "English",
    msName: "Bahasa Melayu",
  },
  status: {
    live: "Live",
    reconnecting: "Reconnecting",
    connecting: "Connecting",
    liveTitle: "Realtime connected",
    reconnectingTitle: "Reconnecting…",
  },
  time: {
    today: "Today",
    tomorrow: "Tmrw",
  },
  units: {
    min: "{n} min",
    hours: "{h}h",
    hoursMinutes: "{h}h {m}m",
  },
  wait: {
    now: "Now",
    approx: "~{duration}",
    noWait: "No wait",
    minsWait: "~{n} mins wait",
    ahead: "{n} ahead",
  },
  actions: {
    back: "Back",
    continue: "Continue",
    close: "Close",
    dismiss: "Dismiss",
    tryAgain: "Try again",
    cancel: "Cancel",
  },
  setup: {
    title: "We're getting the shop ready",
    body: "Online booking is temporarily unavailable. Please try again shortly.",
  },
} as const;
