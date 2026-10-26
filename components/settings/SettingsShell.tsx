"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useApp } from "@/lib/context";
import type { SettingsSection } from "@/lib/settings/sections";
import { SettingsMenu, SettingsSectionList } from "@/components/settings/SettingsNav";
import { SettingsSectionContent } from "@/components/settings/SettingsSections";

/**
 * Settings by sections (docs/settings-sections-plan.md).
 * Desktop: menu on the left, the section on the right. Phone: `/settings` is the list of sections; a section opens on
 * its own screen with «← Settings». `index` = the bare `/settings` address.
 */
export function SettingsShell({ section, index = false }: { section: SettingsSection; index?: boolean }) {
  const { dict } = useApp();
  const t = dict.settings.sections;
  return (
    <div className="max-w-4xl space-y-4">
      {/* Title: always on desktop; on a phone only on the list screen */}
      <div className={index ? "" : "hidden md:block"}>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.settings.title}</h1>
        <p className="mt-1 text-xs text-mu">{dict.settings.subtitle}</p>
      </div>

      {index && (
        <div className="md:hidden">
          <SettingsSectionList />
        </div>
      )}

      <div className={index ? "hidden md:grid md:grid-cols-[200px,minmax(0,1fr)] md:gap-6" : "md:grid md:grid-cols-[200px,minmax(0,1fr)] md:gap-6"}>
        <aside className="hidden md:block">
          <div className="sticky top-4">
            <SettingsMenu active={section} />
          </div>
        </aside>
        <section aria-labelledby="settings-section-title" className="min-w-0 space-y-4" data-testid={`settings-section-${section}`}>
          {/* Phone: back to the list */}
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-mu hover:text-tx md:hidden" data-testid="settings-back">
            <ChevronLeft size={16} aria-hidden="true" />
            <span>{t.back}</span>
          </Link>
          <div>
            <h2 id="settings-section-title" className="font-serif text-xl font-bold text-tx">
              {t[section].title}
            </h2>
            <p className="mt-0.5 text-xs text-mu">{t[section].description}</p>
          </div>
          <SettingsSectionContent section={section} />
        </section>
      </div>
    </div>
  );
}
