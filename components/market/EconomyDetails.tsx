import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Native disclosure keeps keyboard and screen-reader behavior without custom state. */
export function EconomyDetails({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return <details className={"group/economy min-w-0 text-xs text-mu " + (compact ? "" : "border-t border-line pt-2")}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded py-1 font-medium text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi [&::-webkit-details-marker]:hidden">
      <span>{label}</span><ChevronDown size={14} aria-hidden="true" className="shrink-0 text-mu transition-transform group-open/economy:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="mt-2 min-w-0 space-y-2 break-words leading-relaxed">{children}</div>
  </details>;
}
