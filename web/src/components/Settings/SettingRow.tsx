// Modeled on Memos' SettingRow.tsx (MIT) — https://github.com/usememos/memos
import { HelpCircleIcon } from "lucide-react";
import type React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: React.ReactNode;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
  vertical?: boolean;
}

const SettingRow: React.FC<SettingRowProps> = ({
  label,
  description,
  tooltip,
  children,
  className,
  vertical = false,
}) => {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 gap-3",
        vertical ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className={cn("flex min-w-0 flex-col gap-1", vertical ? "w-full" : "flex-1")}>
        <div className="flex items-center gap-1.5">
          <div className={cn("text-sm", vertical ? "font-medium" : "")}>{label}</div>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger render={<HelpCircleIcon className="size-4 cursor-help text-muted-foreground" />} />
              <TooltipContent>
                <p className="max-w-xs">{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={cn("flex min-w-0 items-center", vertical ? "w-full" : "w-full sm:w-auto sm:shrink-0")}>
        {children}
      </div>
    </div>
  );
};

export default SettingRow;
