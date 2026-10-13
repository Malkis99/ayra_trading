import React from "react";
import { cn } from "./cn";

type CardProps = React.HTMLAttributes<HTMLElement> & {
  /** "default": surface with border. "quiet": no border/background, for page sections. */
  variant?: "default" | "quiet";
  as?: "div" | "section" | "article";
};

export function Card({ variant = "default", as: Tag = "div", className, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        variant === "default" ? "rounded-lg border border-line bg-s1 p-4 md:p-5" : "p-0",
        className
      )}
      {...rest}
    />
  );
}
