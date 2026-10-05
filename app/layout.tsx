import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "AYRA Trading",
  description: "Awaken Your Potential. Trade · Train · Evolve.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
