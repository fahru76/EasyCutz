"use client";

import { create } from "zustand";
import { MAX_ADDONS, MAX_SERVICES, toggleId } from "@/lib/cart";
import type { BarberChoice, BookingMode, CustomerDetails, PaymentOption, TimeSlot } from "@/lib/types/domain";

export const BOOKING_STEPS = ["services", "barber", "when", "details"] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];

export interface BookingState {
  step: BookingStep;
  serviceIds: string[];
  addonIds: string[];
  barberId: BarberChoice;
  mode: BookingMode;
  date: string | null;
  slot: TimeSlot | null;
  paymentOption: PaymentOption;
  customer: CustomerDetails;

  toggleService: (id: string) => void;
  toggleAddon: (id: string) => void;
  setBarber: (id: BarberChoice) => void;
  setMode: (mode: BookingMode) => void;
  setDate: (date: string) => void;
  setSlot: (slot: TimeSlot | null) => void;
  setPaymentOption: (option: PaymentOption) => void;
  updateCustomer: (patch: Partial<CustomerDetails>) => void;
  /** Drops items that are no longer on the menu (owner hid or removed them). */
  pruneCart: (validServiceIds: ReadonlySet<string>, validAddonIds: ReadonlySet<string>) => void;
  goTo: (step: BookingStep) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
}

const initialCustomer: CustomerDetails = { name: "", phone: "", email: "", notes: "" };

const initialState = {
  step: "services" as BookingStep,
  serviceIds: [] as string[],
  addonIds: [] as string[],
  barberId: "any" as BarberChoice,
  mode: "walk_in" as BookingMode,
  date: null as string | null,
  slot: null as TimeSlot | null,
  paymentOption: "cash_on_site" as PaymentOption,
  customer: initialCustomer,
};

export const useBookingStore = create<BookingState>()((set, get) => ({
  ...initialState,

  // Anything that changes the cart's duration or barber invalidates a chosen slot.
  toggleService: (id) => set((s) => ({ serviceIds: toggleId(s.serviceIds, id, MAX_SERVICES), slot: null })),
  toggleAddon: (id) => set((s) => ({ addonIds: toggleId(s.addonIds, id, MAX_ADDONS), slot: null })),
  setBarber: (barberId) => set({ barberId, slot: null }),
  setMode: (mode) => set({ mode, slot: null }),
  setDate: (date) => set({ date, slot: null }),
  setSlot: (slot) => set({ slot }),
  setPaymentOption: (paymentOption) => set({ paymentOption }),
  updateCustomer: (patch) => set((s) => ({ customer: { ...s.customer, ...patch } })),
  pruneCart: (validServiceIds, validAddonIds) => {
    const { serviceIds, addonIds } = get();
    const keptServices = serviceIds.filter((id) => validServiceIds.has(id));
    const keptAddons = addonIds.filter((id) => validAddonIds.has(id));
    if (keptServices.length !== serviceIds.length || keptAddons.length !== addonIds.length) {
      set({ serviceIds: keptServices, addonIds: keptAddons, slot: null });
    }
  },
  goTo: (step) => set({ step }),
  next: () => {
    const i = BOOKING_STEPS.indexOf(get().step);
    const nextStep = BOOKING_STEPS[Math.min(i + 1, BOOKING_STEPS.length - 1)];
    if (nextStep) set({ step: nextStep });
  },
  back: () => {
    const i = BOOKING_STEPS.indexOf(get().step);
    const prev = BOOKING_STEPS[Math.max(i - 1, 0)];
    if (prev) set({ step: prev });
  },
  reset: () => set({ ...initialState, customer: { ...initialCustomer } }),
}));
