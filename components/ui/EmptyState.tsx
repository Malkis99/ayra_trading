import React from "react";
import { cn } from "./cn";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

/** Icon, one title, one sentence, one action. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-center", className)}>
      {icon && <div className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-pri/20 text-vi" aria-hidden="true">{icon}</div>}
      <p className="text-sm font-semibold text-tx">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-mu">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
