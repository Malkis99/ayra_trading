"use client";

import React from "react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { DEFAULT_SETTINGS_SECTION } from "@/lib/settings/sections";

/** `/settings`: the list of sections on a phone, the first section (Profile) with the menu on wide screens. */
export default function SettingsPage() {
  return <SettingsShell section={DEFAULT_SETTINGS_SECTION} index />;
}
