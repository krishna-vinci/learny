// Pre-existing Settings content (service health list), moved here unchanged and wrapped
// in SettingSection so it fits the M3a Memos-style section layout.
import type { ServiceHealth } from "@studium/shared";
import { RefreshCwIcon } from "lucide-react";
import { useSettings } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SettingSection from "./SettingSection";

function ServiceRow({ service }: { service: ServiceHealth }) {
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-border/70 py-2 last:border-b-0">
      <span
        className={cn("size-2.5 shrink-0 rounded-full", service.ok ? "bg-success" : "bg-destructive")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate font-medium text-foreground">{service.name}</span>
          <span className="text-2xs uppercase tracking-wide text-muted-foreground/70">{service.kind}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{service.detail}</p>
      </div>
      {service.tools != null && (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/70">{service.tools} tools</span>
      )}
    </li>
  );
}

const ServicesSection = () => {
  const { data, isLoading, isError, refetch, isFetching } = useSettings();

  return (
    <SettingSection
      title="Services"
      actions={
        <Button variant="outline" size="sm" className="h-11 sm:h-7" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCwIcon className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
          Refresh
        </Button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Failed to load settings.</p>
      ) : (
        <ul className="rounded-md border border-border/70 px-3">
          {data.services.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No services configured.</li>
          )}
          {data.services.map((service) => (
            <ServiceRow key={service.name} service={service} />
          ))}
        </ul>
      )}
    </SettingSection>
  );
};

export default ServicesSection;
