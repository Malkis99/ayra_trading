import type { Metadata } from "next";
import { cookies } from "next/headers";
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
    <html lang={initialLang}>
      <body>
        <Shell initialLang={initialLang}>{children}</Shell>
      </body>
    </html>
  );
}
