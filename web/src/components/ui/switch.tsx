// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";
import { FOCUS_VISIBLE_OUTLINE_CLASSES } from "./focus";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input transition-colors data-[checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        FOCUS_VISIBLE_OUTLINE_CLASSES,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-[18px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
