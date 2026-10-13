import React from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-pri text-white hover:bg-[#5d3fa3]",
  secondary: "border border-line bg-s2 text-tx hover:border-vi",
  ghost: "text-mu hover:bg-s2 hover:text-tx",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const SIZES: Record<ButtonSize, string> = {
  // md keeps a 44px tap target; sm is for dense desktop toolbars only.
  md: "min-h-[44px] px-4 text-sm",
  sm: "min-h-[36px] px-3 text-xs",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...rest },
  ref
) {
  return <button ref={ref} type={type} className={buttonClasses(variant, size, className)} {...rest} />;
});
