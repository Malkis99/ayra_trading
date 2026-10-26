import React from "react";
import { notFound } from "next/navigation";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { SETTINGS_SECTIONS, isSettingsSection } from "@/lib/settings/sections";

/** `/settings/<section>`: one settings section; an unknown name shows the «not found» page (checked on the server). */
export default function SettingsSectionPage({ params }: { params: { section: string } }) {
  if (!isSettingsSection(params.section)) notFound();
  return <SettingsShell section={params.section} />;
}

export function generateStaticParams() {
  return SETTINGS_SECTIONS.map((section) => ({ section }));
}

/** Only the six sections exist. */
export const dynamicParams = false;
