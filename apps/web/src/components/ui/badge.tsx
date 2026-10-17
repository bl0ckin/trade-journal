import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        /** Win/loss chips: text carries the state; color reinforces. */
        profit: "border-transparent bg-profit/15 text-profit",
        loss: "border-transparent bg-loss/15 text-loss",
        /** Open positions: a soft blue chip, readable in both themes. */
        open: "border-transparent bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
