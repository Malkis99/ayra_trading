import React from "react";
import { cn } from "./cn";

type SectionHeaderProps = {
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  level?: 2 | 3;
  className?: string;
};

export function SectionHeader({ title, icon, action, level = 2, className }: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <Heading className="flex items-center gap-2 text-[15px] font-semibold text-tx">
        {icon && <span className="text-vi" aria-hidden="true">{icon}</span>}
        <span>{title}</span>
      </Heading>
      {action && <div className="shrink-0 text-sm">{action}</div>}
    </div>
  );
}
