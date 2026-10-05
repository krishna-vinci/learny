// Admin → Settings → Integrations → YouTube: engine status + one-click install,
// and the optional guided cookie upload. Plain-language status only; secrets
// never render here (the API returns status, never contents).
import type { YoutubeIntegrationStatus } from "@studium/shared";
import { DownloadIcon, RefreshCwIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  useInstallYoutubeEngine,
  useRemoveYoutubeCookies,
  useSettings,
  useUpdateYoutubeEngine,
  useUploadYoutubeCookies,
  useYoutubeStatus,
} from "@/api/queries";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SettingSection from "./SettingSection";

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const classes =
    tone === "ok"
      ? "bg-success/15 text-success"
      : tone === "warn"
        ? "bg-warning/15 text-warning-ink"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium", classes)}>
      {children}
    </span>
  );
}

function EnginePanel({ status }: { status: YoutubeIntegrationStatus }) {
  const install = useInstallYoutubeEngine();
  const update = useUpdateYoutubeEngine();
  const pending = install.isPending || update.isPending;
  const engine = status.engine;
  const unsupported = !engine.platformSupported;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{status.modeLabel}</span>
        {status.cookies.stale && <StatusPill tone="warn">Sign-in expired — re-export cookies</StatusPill>}
        {status.updateRecommended && <StatusPill tone="warn">Update recommended</StatusPill>}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex justify-between gap-2 sm:justify-start sm:gap-1.5">
          <dt>Engine</dt>
          <dd className="text-foreground">
            {engine.state === "found" ? `yt-dlp ${engine.version ?? "installed"}` : "Not installed"}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:justify-start sm:gap-1.5">
          <dt>Server</dt>
          <dd className="text-foreground">{engine.platformLabel}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:justify-start sm:gap-1.5">
          <dt>Node runtime</dt>
          <dd className="text-foreground">{engine.nodePresent ? "Available" : "Missing"}</dd>
        </div>
        {engine.managedShadowed && (
          <div className="flex justify-between gap-2 sm:justify-start sm:gap-1.5">
            <dt>Managed copy</dt>
            <dd className="text-foreground">Shadowed by the server's configured binary</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {unsupported ? (
          <p className="text-sm text-muted-foreground">yt-dlp is not available on this server.</p>
        ) : engine.state === "missing" ? (
          <Button size="sm" className="h-11 sm:h-8" onClick={() => install.mutate(undefined)} disabled={pending}>
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            {install.isPending ? "Installing…" : "Install"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            onClick={() => update.mutate(undefined)}
            disabled={pending}
          >
            <RefreshCwIcon className={cn("size-3.5", update.isPending && "animate-spin")} aria-hidden="true" />
            {update.isPending ? "Updating…" : "Update"}
          </Button>
        )}
        {install.isError && <p className="text-xs text-destructive">{install.error.message}</p>}
        {update.isError && <p className="text-xs text-destructive">{update.error.message}</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        With no engine, sources are still added with their real title, channel and thumbnail so you can watch them; the
        transcript is skipped.
      </p>
    </div>
  );
}

const COOKIE_STEPS = [
  "Make a throwaway Google account.",
  "Use a separate browser profile for it.",
  "Install a cookies.txt exporter extension.",
  "Sign in to YouTube in that profile.",
  "Export youtube.com cookies as cookies.txt.",
  "Upload the file here.",
  "Don't use that profile again.",
];

function CookiePanel({ status }: { status: YoutubeIntegrationStatus }) {
  const upload = useUploadYoutubeCookies();
  const remove = useRemoveYoutubeCookies();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const cookies = status.cookies;

  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    upload.mutate(file, {
      onError: (mutationError) => {
        setError(mutationError.message);
        // Clear the input so replacing/retrying the same file can fire again.
        if (input.current) input.current.value = "";
      },
      onSuccess: () => {
        if (input.current) input.current.value = "";
      },
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">YouTube sign-in</span>
        {!cookies.configured && <StatusPill tone="muted">Optional</StatusPill>}
        {cookies.source === "env" && <StatusPill tone="muted">Provided by the server environment</StatusPill>}
        {cookies.configured && cookies.readable && !cookies.stale && <StatusPill tone="ok">Configured</StatusPill>}
        {cookies.source === "uploaded" && cookies.configured && <StatusPill tone="muted">Uploaded</StatusPill>}
        {cookies.stale && <StatusPill tone="warn">Sign-in expired — re-export cookies</StatusPill>}
        {cookies.source === "env" && !cookies.readable && <StatusPill tone="warn">File not readable</StatusPill>}
      </div>

      <p className="text-xs text-muted-foreground">
        Cookies are optional and only needed for videos YouTube blocks. They are stored encrypted and are never shown
        again. Use a throwaway Google account — this file signs in as that account.
      </p>

      <details className="text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-1 sm:min-h-0">How to export cookies.txt</summary>
        <ol className="mt-1 list-decimal space-y-0.5 ps-5">
          {COOKIE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>

      {cookies.lastSuccessAt !== null && (
        <p className="text-xs text-muted-foreground">
          Last successful signed-in fetch: {new Date(cookies.lastSuccessAt).toLocaleString()}
        </p>
      )}

      {cookies.source === "none" || cookies.source === "uploaded" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            <UploadIcon className="size-3.5" aria-hidden="true" />
            {upload.isPending ? "Uploading…" : cookies.configured ? "Replace cookies.txt" : "Upload cookies.txt"}
          </Button>
          {cookies.source === "uploaded" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 sm:h-8"
              onClick={() => remove.mutate(undefined)}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This server provides the cookie file through its environment; replace it on the server to update.
        </p>
      )}
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
      {remove.isError && <p className="text-xs text-destructive">{remove.error.message}</p>}
    </div>
  );
}

const IntegrationsSection = () => {
  const status = useYoutubeStatus();
  const settings = useSettings();
  const exa = settings.data?.exa;

  return (
    <SettingSection
      title="Integrations"
      description="Optional services that improve how sources are read on this server."
    >
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-foreground">Source search · Exa</h4>
        {settings.isLoading ? (
          <RowsSkeleton rows={2} />
        ) : !exa ? (
          <p className="text-sm text-destructive">Failed to load search spend.</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-border/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base text-foreground">
                ${exa.spendUsd.toFixed(3)} this month ({exa.month}, UTC)
              </span>
              <StatusPill tone={exa.status === "ready" ? "ok" : exa.status === "off" ? "muted" : "warn"}>
                {
                  {
                    ready: "Active",
                    warning: "Near monthly limit",
                    stopped: "Monthly limit reached",
                    off: "Not configured",
                    unavailable: "Spend tracking unavailable",
                  }[exa.status]
                }
              </StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">
              Warn at ${exa.warnUsd.toFixed(2)} · stop at ${exa.stopUsd.toFixed(2)}.
              {exa.status === "stopped"
                ? " Papers use papers MCP; other searches use SearXNG until next month."
                : exa.status === "unavailable"
                  ? " Papers use papers MCP; other searches use SearXNG while spend cannot be tracked safely."
                  : exa.status === "off"
                    ? " Papers use papers MCP; other searches use SearXNG when available."
                    : " Papers use papers MCP first. Exa finds YouTube videos; SearXNG fills gaps."}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-foreground">YouTube</h4>
        {status.isLoading ? (
          <RowsSkeleton rows={2} />
        ) : status.isError || !status.data ? (
          <p className="text-sm text-destructive">Failed to load YouTube status.</p>
        ) : (
          <>
            <EnginePanel status={status.data} />
            <CookiePanel status={status.data} />
          </>
        )}
      </div>
    </SettingSection>
  );
};

export default IntegrationsSection;
