/**
 * Deep links that open WhatsApp / the SMS app with a pre-filled message.
 * No third-party messaging API or credentials are needed: the host taps the
 * link on the desk tablet/phone and presses send.
 */

export function whatsappLink(e164Phone: string, message: string): string {
  const digits = e164Phone.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** `?&body=` is understood by both iOS and Android messaging apps. */
export function smsLink(e164Phone: string, message: string): string {
  return `sms:${e164Phone}?&body=${encodeURIComponent(message)}`;
}

export function turnSoonMessage(args: {
  shopName: string;
  customerName: string;
  label: string;
  minutes: number;
  passUrl: string;
}): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  const when = args.minutes <= 1 ? "now" : `in about ${args.minutes} minutes`;
  return (
    `Hi ${first}, it's ${args.shopName}! Your turn (${args.label}) is coming up ${when}. ` +
    `Please head over to the shop. Live pass: ${args.passUrl}`
  );
}

export function calledNowMessage(args: { shopName: string; customerName: string; label: string; barberName: string }): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  return `Hi ${first}, ${args.barberName} at ${args.shopName} is ready for you now (${args.label}). See you at the chair!`;
}

/** EZ-011: the barber is running behind for a booked customer. */
export function delayMessage(args: {
  shopName: string;
  customerName: string;
  barberName: string;
  delayMin: number;
  expectedTime: string;
  passUrl: string;
}): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  return (
    `Hi ${first}, it's ${args.shopName}. ${args.barberName} is running about ${args.delayMin} min late today — ` +
    `your new expected start is ${args.expectedTime}. Sorry for the wait! Live pass: ${args.passUrl}`
  );
}

/** EZ-011: the barber is free early; invite the booked customer to come in now (their booking stays as is). */
export function freeEarlyMessage(args: {
  shopName: string;
  customerName: string;
  barberName: string;
  bookedTime: string;
  passUrl: string;
}): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  return (
    `Hi ${first}, it's ${args.shopName}. ${args.barberName} is free early — if you can come in now, ` +
    `we'll seat you straight away. If not, no worries: your ${args.bookedTime} booking stays as is. Live pass: ${args.passUrl}`
  );
}

const REASON_TEXT: Record<string, string> = {
  delay: "your barber is running late today",
  closure: "the shop has to close at your booking time",
  barber_unavailable: "your barber is unavailable at your booking time",
  manual: "we need to move your booking",
  early: "a chair has opened up earlier",
};

/** EZ-002: list the held times and link to the pass where the customer taps one. */
export function rescheduleOffersMessage(args: {
  shopName: string;
  customerName: string;
  reason: string;
  options: string[];
  holdUntil: string;
  passUrl: string;
}): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  const list = args.options.map((o, i) => `${i + 1}) ${o}`).join("\n");
  const why = REASON_TEXT[args.reason] ?? REASON_TEXT.manual;
  return (
    `Hi ${first}, it's ${args.shopName}. Sorry — ${why}. We're holding these times for you:\n${list}\n` +
    `Tap to choose (held until ${args.holdUntil}): ${args.passUrl}?reschedule=1`
  );
}

/** EZ-011 + EZ-002: an earlier slot is held for the customer. */
export function earlierSlotMessage(args: {
  shopName: string;
  customerName: string;
  barberName: string;
  newTime: string;
  bookedTime: string;
  passUrl: string;
}): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  return (
    `Hi ${first}, it's ${args.shopName}. ${args.barberName} is free early — we can take you at ${args.newTime} ` +
    `instead of ${args.bookedTime}. Tap to move: ${args.passUrl}?reschedule=1 (or ignore this to keep ${args.bookedTime}).`
  );
}

/** EZ-002: confirmation after the desk moved a booking. */
export function rescheduledMessage(args: {
  shopName: string;
  customerName: string;
  barberName: string;
  newTime: string;
  passUrl: string;
}): string {
  const first = args.customerName.split(/\s+/)[0] ?? args.customerName;
  return `Hi ${first}, your ${args.shopName} booking is now ${args.newTime} with ${args.barberName}. Live pass: ${args.passUrl}`;
}
