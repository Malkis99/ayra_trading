import React from "react";
import { BookCheck, Hand } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** How a quest is confirmed: by the journal (XP and coins by the rules) or by the person (XP only). */
export function VerificationBadge({ source, label }: { source: "journal" | "self"; label: string }) {
  const Icon = source === "journal" ? BookCheck : Hand;
  return (
    <span
      data-testid={`quest-badge-${source}`}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        source === "journal" ? "border-success/35 text-success" : "border-[#e5b98a]/40 text-[#e5b98a]"
      )}
    >
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}
