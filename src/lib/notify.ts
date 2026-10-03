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
