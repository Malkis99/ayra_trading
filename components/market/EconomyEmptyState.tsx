import React from "react";

/** Text only: never reserve a chart height, surface or border for missing observations. */
export function EconomyEmptyState({ children }: { children: React.ReactNode }) {
  return <p data-economy-empty role="status" className="text-xs leading-snug text-mu">{children}</p>;
}
