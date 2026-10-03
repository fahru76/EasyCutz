import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted variable fonts (no build-time call to Google Fonts; no third-party requests at runtime).
const jakarta = localFont({
  src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  variable: "--font-jakarta",
  weight: "200 800",
  display: "swap",
});

const jetbrains = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "EasyCutz — Book a cut or join the live queue",
    template: "%s · EasyCutz",
  },
  description:
    "Book your barber online or take a virtual walk-in number. Live wait times, digital queue pass and WhatsApp reminders.",
  applicationName: "EasyCutz",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
