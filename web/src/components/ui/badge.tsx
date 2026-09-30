// shadcn/ui Badge (base-nova, Base UI), with Studium's status variants mapped onto our tokens.
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-2xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        // Status colours: tinted fill, coloured ink (same pairs the old hand-built chips used).
        muted: "bg-muted text-muted-foreground",
        tint: "bg-primary/15 text-primary",
        accent: "bg-accent text-accent-foreground",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning-ink",
        destructive: "bg-destructive/15 text-destructive",
      },
      caps: {
        true: "uppercase tracking-wide",
        false: "",
      },
    },
    defaultVariants: {
      variant: "muted",
      caps: false,
    },
  },
);

function Badge({
  className,
  variant,
  caps,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant, caps }), className) }, props),
    render,
    state: { slot: "badge", variant },
  });
}

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export { Badge, type BadgeVariant, badgeVariants };
