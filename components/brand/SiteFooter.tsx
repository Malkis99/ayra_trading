"use client";

import React from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { Logo } from "./Logo";

/** The page's footer: a small sign, «AYRA Trading» and the slogan, with the legal links. */
export function SiteFooter() {
  const { dict } = useApp();
  const b = dict.brand;
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line/60 pt-4 text-[11px] text-mu" data-testid="site-footer">
      <span className="inline-flex items-center gap-2">
        <Logo variant="mark" height={20} decorative />
        <span className="font-semibold text-tx">{b.name}</span>
        <span aria-hidden="true">·</span>
        <span>{b.slogan}</span>
      </span>
      <span className="inline-flex flex-wrap items-center gap-x-3">
        <Link href="/legal/terms" className="hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
          {dict.legal.termsTitle}
        </Link>
        <Link href="/legal/privacy" className="hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
          {dict.legal.privacyTitle}
        </Link>
      </span>
    </footer>
  );
}
