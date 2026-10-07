import type { Dict } from "../../types";
import type { errors as en } from "../en/errors";

// Draft BM wording: every line marked TODO(review) waits for Fahru's approval (EZ-010).
export const errors: Dict<typeof en> = {
  empty_cart: "Pilih sekurang-kurangnya satu servis.", // TODO(review)
  cart_too_large: "Banyak sangat servis — sila bahagikan kepada dua lawatan.", // TODO(review)
  duplicate_items: "Troli anda ada item yang berulang.", // TODO(review)
  unknown_service: "Salah satu servis sudah tiada. Sila muat semula menu.", // TODO(review)
  unknown_addon: "Salah satu tambahan sudah tiada. Sila muat semula menu.", // TODO(review)
  nothing_to_charge: "Tiada bayaran dalam talian untuk tempahan ini.", // TODO(review)
  shop_closed: "Kedai sedang tutup, jadi giliran langsung dihentikan buat sementara.", // TODO(review)
  closed_window: "Kedai tutup pada waktu itu. Sila pilih waktu atau hari lain.", // TODO(review)
  barber_unavailable: "Tukang gunting itu tidak menerima pelanggan sekarang. Cuba Mana-mana Yang Kosong.", // TODO(review)
  already_in_queue: "Nombor telefon ini sudah ada tiket aktif hari ini.", // TODO(review)
  slot_in_past: "Waktu itu baru sahaja berlalu. Sila pilih slot yang lebih lewat.", // TODO(review)
  beyond_horizon: "Tarikh itu terlalu jauh untuk ditempah.", // TODO(review)
  misaligned_slot: "Sila pilih salah satu slot waktu yang disenaraikan.", // TODO(review)
  slot_unavailable: "Ada orang baru sahaja mengambil slot itu. Sila pilih waktu lain.", // TODO(review)
  not_found: "Kami tidak dapat mencari tempahan itu.", // TODO(review)
  invalid_transition: "Tempahan ini tidak boleh diubah lagi.", // TODO(review)
  forbidden: "Untuk kakitangan sahaja.", // TODO(review)
  chair_busy: "Kerusi itu sudah ada pelanggan.", // TODO(review)
  barber_required: "Pilih tukang gunting dahulu.", // TODO(review)
  reschedule_cutoff:
    "Sudah terlalu hampir dengan waktu tempahan anda untuk diubah dalam talian. Sila WhatsApp kedai dan kami akan uruskan.", // TODO(review)
  offer_expired: "Waktu itu tidak lagi disimpan untuk anda. Sila pilih yang lain.", // TODO(review)
  invalid_request: "Ada yang tidak kena dengan permintaan itu. Sila cuba lagi.", // TODO(review)
  invalid_value: "Salah satu nilai di luar julat.", // TODO(review)
  invalid_action: "Tindakan itu tidak dibenarkan.", // TODO(review)
  payments_unavailable: "Bayaran dalam talian tidak tersedia sekarang — sila pilih Bayar di kedai.", // TODO(review)
  rate_limited: "Terlalu banyak cubaan. Sila tunggu seminit dan cuba lagi.", // TODO(review)
  server_error: "Ada masalah di pihak kami. Sila cuba lagi.", // TODO(review)
  network: "Tidak dapat menghubungi kedai sekarang. Semak sambungan anda dan cuba lagi.", // TODO(review)
};
