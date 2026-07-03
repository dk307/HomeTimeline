import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

const VARIANTS: Record<Variant, string> = {
  default: "border-transparent bg-primary/10 text-primary",
  secondary: "border-transparent bg-muted text-muted-foreground",
  success: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warning: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
  destructive: "border-transparent bg-destructive/10 text-destructive",
  outline: "border-border text-foreground",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

/** Compact status pill. Use one variant per meaning across the app. */
export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
