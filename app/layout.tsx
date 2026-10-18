import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./fonts.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { Language } from "@/lib/i18n/types";

export const metadata: Metadata = {
  title: "AYRA Trading",
  description: "Awaken Your Potential. Trade · Train · Evolve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const savedLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const initialLang: Language = savedLocale === "en" ? "en" : "ru";

  return (
    <html lang={initialLang} className="font-sans">
      <head>
        {/* Self-hosted Manrope (app/fonts.css): the two subsets every page needs */}
        <link rel="preload" href="/fonts/manrope/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/manrope/manrope-cyrillic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased tabular-nums">
        <Shell initialLang={initialLang}>{children}</Shell>
      </body>
    </html>
  );
}
