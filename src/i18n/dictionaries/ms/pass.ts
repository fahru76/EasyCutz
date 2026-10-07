import type { Dict } from "../../types";
import type { pass as en } from "../en/pass";

// Draft BM wording: every line marked TODO(review) waits for Fahru's approval (EZ-010).
export const pass: Dict<typeof en> = {
  status: {
    waiting: "Menunggu", // TODO(review)
    called: "Giliran anda!", // TODO(review)
    in_chair: "Di Kerusi", // TODO(review)
    completed: "Selesai", // TODO(review)
    no_show: "Terlepas", // TODO(review)
    cancelled: "Dibatalkan", // TODO(review)
    pending_payment: "Menunggu bayaran", // TODO(review)
    confirmed: "Disahkan", // TODO(review)
    checked_in: "Sudah daftar masuk", // TODO(review)
    expired: "Tamat tempoh", // TODO(review)
  },
  progress: {
    label: "Status", // TODO(review)
    waiting: "Menunggu", // TODO(review)
    booked: "Ditempah", // TODO(review)
    checkedIn: "Daftar masuk", // TODO(review)
    inChair: "Di Kerusi", // TODO(review)
    completed: "Selesai", // TODO(review)
  },
  kind: {
    ticket: "Pas giliran langsung", // TODO(review)
    appointment: "Pas temujanji", // TODO(review)
  },
  details: {
    name: "Nama", // TODO(review)
    barber: "Tukang gunting", // TODO(review)
    likely: "(mungkin)", // TODO(review)
    firstAvailable: "Mana-mana yang kosong dahulu", // TODO(review)
    scanToCheckIn: "Imbas di kaunter untuk daftar masuk", // TODO(review)
  },
  ticket: {
    label: "Tiket", // TODO(review)
    waitingForChair: "Menunggu kerusi kosong", // TODO(review)
    around: "sekitar {time}", // TODO(review)
    runningBehind: "Tukang gunting anda lewat sedikit — anggaran ini dikemas kini secara langsung.", // TODO(review)
    enjoy: "Selamat bergunting ✂︎", // TODO(review)
  },
  appointment: {
    until: "hingga {time}", // TODO(review)
    runningLateBefore: "Lewat ~{n} min — dijangka mula", // TODO(review)
    runningLateAfter: ". Dikemas kini secara langsung.", // TODO(review)
    slotHeld: "Slot ditahan sehingga {time} — lengkapkan bayaran untuk mengesahkan.", // TODO(review)
  },
  turn: {
    calledTitle: "Giliran anda — sila ke kerusi!", // TODO(review)
    soonTitle: "Hampir giliran anda", // TODO(review)
    barberReady: "{barber} sudah sedia untuk anda.", // TODO(review)
    yourBarber: "Tukang gunting anda", // TODO(review)
    checkedInSoon: "Anda sudah daftar masuk — lebih kurang {n} min lagi. Sila tunggu berhampiran kerusi.", // TODO(review)
    soon: "Lebih kurang {n} min lagi. Sila bergerak ke kedai sekarang.", // TODO(review)
    chairOpening: "Kerusi akan kosong sekarang — sila ke kedai.", // TODO(review)
  },
  notification: {
    calledTitle: "Giliran anda!", // TODO(review)
    soonTitle: "Hampir giliran anda", // TODO(review)
    yourAppointment: "temujanji anda", // TODO(review)
    calledBody: "{barber} sudah sedia untuk {label}.", // TODO(review)
    soonBody: "Lebih kurang {n} min lagi untuk {label}. Sila ke {shop}.", // TODO(review)
  },
  payment: {
    received: "Bayaran diterima. Semua sudah beres!", // TODO(review)
    submitted: "Bayaran dihantar — sedang disahkan dengan bank…", // TODO(review)
    notCompleted: "Bayaran tidak selesai. Tempat anda ditahan sebentar — sila lengkapkan bayaran di bawah.", // TODO(review)
    depositPaid: "Deposit dibayar · baki di kedai", // TODO(review)
    paidInFull: "Dibayar penuh", // TODO(review)
    payAtShop: "Bayar di kedai", // TODO(review)
    onlineFailed: "Bayaran dalam talian gagal · bayar di kedai", // TODO(review)
    onlinePending: "Bayaran dalam talian belum selesai", // TODO(review)
    complete: "Lengkapkan bayaran", // TODO(review)
    couldNotOpen: "Tidak dapat membuka halaman bayaran.", // TODO(review)
  },
  actions: {
    share: "Kongsi pas", // TODO(review)
    shareTitle: "Pas {shop}", // TODO(review)
    linkCopied: "Pautan pas telah disalin.", // TODO(review)
    alertMe: "Beritahu saya", // TODO(review)
    whatsappShop: "WhatsApp kedai", // TODO(review)
    whatsappTicket: "Hai {shop}, berkenaan tiket saya {code}: ", // TODO(review)
    whatsappAppointment: "Hai {shop}, berkenaan temujanji saya: ", // TODO(review)
    bookAgain: "Tempah lagi", // TODO(review)
  },
  cancel: {
    confirmTicket: "Lepaskan giliran anda?", // TODO(review)
    confirmAppointment: "Batalkan tempahan ini?", // TODO(review)
    yesLeave: "Ya, keluar", // TODO(review)
    yesCancel: "Ya, batalkan", // TODO(review)
    keep: "Kekalkan", // TODO(review)
    leaveQueue: "Keluar dari giliran", // TODO(review)
    cancelBooking: "Batalkan tempahan", // TODO(review)
  },
  ended: {
    thanks: "Terima kasih kerana datang — nampak segak!", // TODO(review)
    inactive: "Pas ini tidak lagi aktif.", // TODO(review)
  },
  closure: {
    ticketCancelledTitle: "Kedai ditutup — tiket anda telah dibatalkan", // TODO(review)
    onlineRefund: "Bayaran dalam talian anda akan dipulangkan. ", // TODO(review)
    welcomeBack: "Anda dialu-alukan untuk menempah atau menyertai giliran semula sebaik kami dibuka.", // TODO(review)
    holdReleasedTitle: "Kedai ditutup — tempahan anda yang belum dibayar telah dilepaskan", // TODO(review)
    paymentRefund: "Bayaran anda akan dipulangkan. ", // TODO(review)
    bookAnother: "Sila tempah waktu lain.", // TODO(review)
    atBookingTimeTitle: "Kedai ditutup sementara pada waktu tempahan anda", // TODO(review)
    keptDetail:
      "Tempahan dan sebarang bayaran anda dikekalkan. Pilih salah satu waktu yang kami tahan untuk anda di bawah, atau pilih waktu lain.", // TODO(review)
    reopeningTitle: "Kedai ditutup sementara · dibuka semula {when}", // TODO(review)
    reopenToday: "hari ini pada {time}", // TODO(review)
    reopenTomorrow: "esok pada {time}", // TODO(review)
    unaffected: "Tempahan anda pada {date} jam {time} tidak terjejas.", // TODO(review)
    sorry: "Maaf atas kesulitan.", // TODO(review)
    bookOtherDay: "Tempah atau beratur pada hari lain", // TODO(review)
  },
  reschedule: {
    earlierFree: "Ada waktu lebih awal yang kosong", // TODO(review)
    holdingTimes: "Kami sedang menahan waktu baharu untuk anda", // TODO(review)
    pleasePick: "Sila pilih waktu baharu", // TODO(review)
    needDifferent: "Perlu tukar waktu?", // TODO(review)
    movedFrom: "Dipindah dari {when}", // TODO(review)
    movedTo: "Dipindah ke {when}. Pas anda telah dikemas kini.", // TODO(review)
    yourBarber: "tukang gunting anda", // TODO(review)
    moveEarlier: "Awalkan waktu saya · ", // TODO(review)
    heldUntil: "Ditahan untuk anda sehingga {time}", // TODO(review)
    orKeep: " — atau kekalkan {time}, tiada apa berubah kecuali anda tekan.", // TODO(review)
    noneWork: "Tiada yang sesuai? Pilih waktu lain", // TODO(review)
    pickAnother: "Pilih waktu lain", // TODO(review)
    cutoff: "Tempahan boleh ditukar dalam talian sehingga {duration} sebelum. Jika lebih dekat, sila WhatsApp kedai.", // TODO(review)
  },
  slots: {
    barberGroup: "Tukang gunting", // TODO(review)
    anyBarber: "Mana-mana tukang gunting", // TODO(review)
    keepBarber: "Kekalkan {barber}", // TODO(review)
    barberFallback: "tukang gunting", // TODO(review)
    date: "Tarikh", // TODO(review)
    blocks: "mengambil {duration}", // TODO(review)
    newDate: "Tarikh baharu", // TODO(review)
    couldNotLoad: "Tidak dapat memuatkan waktu", // TODO(review)
    retry: "Cuba lagi", // TODO(review)
    noWindow: "Tiada slot {duration} yang kosong pada hari ini.", // TODO(review)
    noWindowTryAny: "Tiada slot {duration} yang kosong pada hari ini — cuba “Mana-mana tukang gunting” atau tarikh lain.", // TODO(review)
    moveTo: "Pindah ke {when} · {barber}", // TODO(review)
    pickNew: "Pilih waktu baharu", // TODO(review)
  },
};
