"use client";

import React, { useEffect, useMemo } from "react";
import { useApp } from "@/lib/context";
import { Select } from "@/components/ui/forms";
import { browserTimeZone, timeZoneOptions } from "@/lib/timezones";

type Props = {
  /** IANA id; empty means "not chosen yet" and is replaced by the browser's zone at once. */
  value: string | null | undefined;
  onChange: (timeZone: string) => void;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
};

/**
 * The one time zone picker (onboarding and settings): every zone, grouped by region, localised names with the
 * UTC offset, search by name, city or "UTC+4". Never empty: defaults to the browser's zone. Stores the IANA id only.
 */
export function TimezoneSelect({ value, onChange, label, hint, disabled, className, id }: Props) {
  const { dict, lang } = useApp();
  const regions = dict.timezones.regions as Record<string, string>;
  const current = value || browserTimeZone();

  useEffect(() => {
    if (!value) onChange(current);
  }, [value, current, onChange]);

  const options = useMemo(
    () => timeZoneOptions(current, lang).map((o) => ({ value: o.value, label: o.label, description: o.description, group: regions[o.region] })),
    [current, lang, regions]
  );

  return (
    <Select
      id={id}
      label={label}
      hint={hint}
      options={options}
      value={current}
      onChange={onChange}
      searchable
      disabled={disabled}
      className={className}
      data-testid="timezone-select"
    />
  );
}
