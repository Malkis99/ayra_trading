import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./fonts.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { Language } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n";

/** Absolute links for the link preview: the production address on Vercel, this machine otherwise. */
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return new URL(vercel ? `https://${vercel}` : "http://localhost:3000");
}

/** «AYRA Trading» and the slogan, in the visitor's language (RU / EN); the brand kit's icons and link preview. */
export function generateMetadata(): Metadata {
  const lang: Language = cookies().get("NEXT_LOCALE")?.value === "en" ? "en" : "ru";
  const b = getDictionary(lang).brand;
  const title = `${b.name} · ${b.slogan}`;
  const og = { url: "/brand/og-1200x630.png", width: 1200, height: 630, alt: b.name };
  const twitterImage = { url: "/brand/twitter-1200x600.png", width: 1200, height: 600, alt: b.name };
  return {
    metadataBase: siteUrl(),
    title: { default: title, template: `%s · ${b.name}` },
    description: b.description,
    applicationName: b.name,
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/brand/icon.svg", type: "image/svg+xml" },
        { url: "/brand/icon-16.png", sizes: "16x16", type: "image/png" },
        { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/icon-48.png", sizes: "48x48", type: "image/png" },
        { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      type: "website",
      siteName: b.name,
      title,
      description: b.description,
      locale: lang === "en" ? "en_US" : "ru_RU",
      images: [og],
    },
    twitter: { card: "summary_large_image", title, description: b.description, images: [twitterImage] },
    appleWebApp: { capable: true, title: b.name, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = { themeColor: "#121117" };

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
