import type { Dict } from "../../types";
import type { booking as en } from "../en/booking";

// Draft BM wording: every line marked TODO(review) waits for Fahru's approval (EZ-010).
export const booking: Dict<typeof en> = {
  flow: {
    stepEyebrow: "Langkah {n}", // TODO(review)
    stepsAria: "Langkah tempahan", // TODO(review)
    steps: {
      services: "Servis", // TODO(review)
      barber: "Tukang gunting", // TODO(review)
      when: "Bila", // TODO(review)
      details: "Butiran", // TODO(review)
    },
    hero: {
      eyebrow: "Kedai gunting · Kuala Lumpur", // TODO(review)
      titleBefore: "Potongan segar. ", // TODO(review)
      titleHighlight: "Tak perlu", // TODO(review)
      titleAfter: " tunggu lama.", // TODO(review)
      body: "Tempah masa yang tepat, atau ambil nombor giliran langsung dan datang bila kerusi anda sudah sedia.", // TODO(review)
      queueClosed: "Giliran ditutup · tempahan dibuka", // TODO(review)
      wait: "Tunggu {wait}", // TODO(review)
      chairsOne: "{n} kerusi", // TODO(review)
      chairsOther: "{n} kerusi", // TODO(review)
    },
    mode: {
      aria: "Jenis tempahan", // TODO(review)
      walkIn: "Ambil giliran langsung", // TODO(review)
      walkInShort: "Walk-in", // TODO(review)
      scheduled: "Tempah masa", // TODO(review)
      scheduledShort: "Tempah", // TODO(review)
    },
    whenTitleScheduled: "Pilih tarikh & masa", // TODO(review)
    whenTitleWalkIn: "Sertai giliran langsung", // TODO(review)
    closureTitle: "Kedai tutup sementara · dibuka semula {reopens}", // TODO(review)
    closureBody: "Giliran langsung dihentikan sementara. Anda masih boleh tempah masa selepas kami dibuka semula.", // TODO(review)
    reopenToday: "hari ini pukul {time}", // TODO(review)
    reopenTomorrow: "esok pukul {time}", // TODO(review)
    cta: {
      pay: "Bayar {amount}", // TODO(review)
      getTicket: "Dapatkan tiket saya", // TODO(review)
      confirm: "Sahkan tempahan", // TODO(review)
    },
    bookingFailed: "Tempahan gagal. Sila cuba lagi.", // TODO(review)
  },
  menu: {
    title: "Pilih servis anda", // TODO(review)
    categories: {
      haircut: "Potong rambut", // TODO(review)
      beard_shave: "Janggut & Cukur", // TODO(review)
      combo: "Kombo", // TODO(review)
      scalp: "Rawatan Kulit Kepala", // TODO(review)
    },
    popular: "Popular", // TODO(review)
    combo: "Kombo", // TODO(review)
    addons: "Tambahan", // TODO(review)
    addonMinutes: "{n}m", // TODO(review)
    addAddon: "Tambah {name}", // TODO(review)
    unlockAddons: "Pilih satu servis dahulu untuk buka pilihan tambahan.", // TODO(review)
  },
  roster: {
    title: "Pilih tukang gunting anda", // TODO(review)
    swipe: "Leret →", // TODO(review)
    aria: "Tukang gunting", // TODO(review)
    firstAvailable: "Mana-mana yang kosong", // TODO(review)
    firstAvailableBody: "Kerusi paling cepat, sesuai untuk walk-in", // TODO(review)
    queueClosed: "Giliran ditutup", // TODO(review)
    chairFreeNow: "Kerusi kosong sekarang", // TODO(review)
    wait: "Tunggu {wait}", // TODO(review)
    bookableLater: "Boleh ditempah untuk tarikh lain", // TODO(review)
    status: {
      offDuty: "Tidak bertugas", // TODO(review)
      onBreak: "Sedang rehat", // TODO(review)
      onBreakBack: "Sedang rehat · kembali {time}", // TODO(review)
      available: "Kosong sekarang", // TODO(review)
      inChairLate: "Sedang menggunting · lewat sikit", // TODO(review)
      inChairLeft: "Sedang menggunting · tinggal {n}m", // TODO(review)
      freeIn: "Kosong dalam ~{n}m", // TODO(review)
      busy: "Sibuk", // TODO(review)
    },
  },
  schedule: {
    date: "Tarikh", // TODO(review)
    closed: "Tutup", // TODO(review)
    time: "Masa", // TODO(review)
    blocks: "tempoh {duration}", // TODO(review)
    loadFailed: "Tak dapat muatkan masa", // TODO(review)
    noMoreToday: "Tiada lagi masa hari ini", // TODO(review)
    fullyBooked: "Penuh ditempah", // TODO(review)
    noWindow: "Tiada slot {duration} lagi pada hari ini. Cuba tarikh lain.", // TODO(review)
    noWindowOrAny: "Tiada slot {duration} lagi pada hari ini. Cuba tarikh lain atau pilih Mana-mana yang kosong.", // TODO(review)
    reserved: "Kerusi ditempah {start} – {end}", // TODO(review)
    barbersFree: "{n} tukang gunting kosong", // TODO(review)
  },
  slots: {
    parts: {
      morning: "Pagi", // TODO(review)
      afternoon: "Petang", // TODO(review)
      evening: "Malam", // TODO(review)
    },
    am: "PG", // TODO(review)
    pm: "PTG", // TODO(review)
    earliest: "Paling awal", // TODO(review)
    open: "{n} kosong", // TODO(review)
    full: "penuh", // TODO(review)
    partsAria: "Waktu", // TODO(review)
    partTimesAria: "Masa {part}", // TODO(review)
    legendOpen: "Kosong", // TODO(review)
    legendTaken: "Sudah diambil", // TODO(review)
  },
  walkIn: {
    closedTitle: "Giliran langsung dihentikan — kedai tutup", // TODO(review)
    closedBody: "Kami jangka dibuka semula {reopens}. Tukar ke “Tempah masa” untuk tempah slot selepas kami dibuka.", // TODO(review)
    barberOffDutyTitle: "{name} tidak bertugas", // TODO(review)
    queueClosedTitle: "Giliran langsung ditutup", // TODO(review)
    barberOffDutyBody: "Pilih Mana-mana yang kosong atau tukang gunting lain, atau tempah masa sahaja.", // TODO(review)
    noBarbersBody: "Tiada tukang gunting yang bertugas sekarang. Tukar ke “Tempah masa” untuk tempah slot.", // TODO(review)
    estWait: "Anggaran tunggu", // TODO(review)
    aheadOfYou: "Di hadapan anda", // TODO(review)
    chairsOpen: "Kerusi dibuka", // TODO(review)
    estimateLine: "— mungkin dengan {barber} sekitar {time}.", // TODO(review)
    nextFreeBarber: "tukang gunting yang kosong dahulu", // TODO(review)
    nowServing: "Sedang dilayan", // TODO(review)
    booked: "Tempahan", // TODO(review)
    minutesLeft: "tinggal {n}m", // TODO(review)
    free: "Kosong", // TODO(review)
    inLine: "Dalam giliran", // TODO(review)
    footnote:
      "Ambil nombor sekarang dan tunggu di mana-mana — pas digital anda dikemas kini secara langsung (Menunggu → Sedang Digunting → Selesai). Kedai akan WhatsApp anda bila tinggal lebih kurang 10 minit, dan pas juga akan beri amaran.", // TODO(review)
  },
  checkout: {
    title: "Butiran anda", // TODO(review)
    name: "Nama penuh", // TODO(review)
    namePlaceholder: "cth. Ahmad Rizal", // TODO(review)
    phone: "Nombor telefon (WhatsApp)", // TODO(review)
    phoneHint: "Kami akan maklumkan bila hampir giliran anda", // TODO(review)
    email: "E-mel", // TODO(review)
    emailHint: "Pilihan · resit", // TODO(review)
    emailPlaceholder: "anda@contoh.com", // TODO(review)
    notes: "Nota untuk tukang gunting", // TODO(review)
    notesHint: "Pilihan", // TODO(review)
    notesPlaceholder: "cth. kekalkan panjang di atas", // TODO(review)
    errors: {
      name: "Masukkan nama anda", // TODO(review)
      phone: "Masukkan nombor telefon yang sah", // TODO(review)
      email: "Masukkan e-mel yang sah", // TODO(review)
    },
    payment: "Bayaran", // TODO(review)
    paymentAria: "Pilihan bayaran", // TODO(review)
    options: {
      cashTitle: "Bayar di kedai", // TODO(review)
      cashDetail: "Tunai, kad atau e-dompet selepas potong", // TODO(review)
      depositTitle: "Bayar deposit", // TODO(review)
      depositDetail: "{percent}% sekarang, baki di kedai", // TODO(review)
      fullTitle: "Bayar penuh", // TODO(review)
      fullDetail: "Tak perlu ke kaunter — terus keluar dengan gaya", // TODO(review)
    },
    secureStripe: "Pembayaran selamat oleh Stripe ·", // TODO(review)
    fpx: "Perbankan dalam talian FPX ·", // TODO(review)
    cards: "kad", // TODO(review)
    paymentsUnavailable: "Bayaran dalam talian tidak tersedia buat masa ini — anda boleh bayar di kedai.", // TODO(review)
    summary: "Ringkasan", // TODO(review)
    dateAtTime: "{date} pukul {time}", // TODO(review)
    walkInSummary: "Walk-in maya · giliran langsung", // TODO(review)
    firstAvailableBarber: "Mana-mana tukang gunting yang kosong", // TODO(review)
    total: "Jumlah", // TODO(review)
  },
  summary: {
    itemsOne: "{n} item · {duration}", // TODO(review)
    itemsOther: "{n} item · {duration}", // TODO(review)
  },
};
