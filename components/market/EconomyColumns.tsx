import React, { Children } from "react";

/** Contiguous DOM order: down the first column, then the second; identical on mobile.
 * Independent stacks do not share row heights or reorder cards when details open. */
export function EconomyColumns({ children, splitAt }: { children: React.ReactNode; splitAt?: number }) {
  const cards = Children.toArray(children);
  const split = splitAt ?? Math.max(1, Math.floor(cards.length / 2));
  return <div data-economy-columns className="grid min-w-0 items-start gap-3 md:grid-cols-2">
    <div className="min-w-0 space-y-3">{cards.slice(0, split)}</div>
    <div className="min-w-0 space-y-3">{cards.slice(split)}</div>
  </div>;
}
