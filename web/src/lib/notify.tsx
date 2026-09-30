// The app's toast API (docs/UX.md rule 5: toasts are rare). A thin layer over react-hot-toast:
// - repeated messages merge (the id defaults to the message text, so a repeat replaces the toast);
// - success toasts hide after 3 s (5 s when they carry an action such as Undo or Open);
// - failures stay until dismissed and can offer one action.
// Use this instead of importing react-hot-toast directly.
import { toast as baseToast, type Renderable, type ToastOptions } from "react-hot-toast";

export const SUCCESS_MS = 3000;
export const ACTION_MS = 5000;

interface Options extends ToastOptions {
  /** One follow-up action, shown as a link-style button inside the toast. */
  action?: { label: string; onClick: () => void };
}

function idFor(message: Renderable | ((...args: never[]) => Renderable), options?: Options): string | undefined {
  if (options?.id) return options.id;
  return typeof message === "string" ? message : undefined;
}

function success(message: string, options?: Options): string {
  const { action, ...rest } = options ?? {};
  const id = idFor(message, options);
  if (!action) return baseToast.success(message, { duration: SUCCESS_MS, ...rest, id });
  return baseToast.success(
    (t) => (
      <span className="flex min-w-0 items-center gap-3">
        <span className="min-w-0">{message}</span>
        <button
          type="button"
          className="min-h-11 shrink-0 font-medium text-primary underline underline-offset-2 md:min-h-0"
          onClick={() => {
            baseToast.dismiss(t.id);
            action.onClick();
          }}
        >
          {action.label}
        </button>
      </span>
    ),
    { duration: ACTION_MS, ...rest, id },
  );
}

function error(message: string, options?: Options): string {
  const { action, ...rest } = options ?? {};
  const id = idFor(message, options);
  return baseToast.custom(
    (t) => (
      <div
        role="alert"
        className="flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border border-destructive/40 bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg"
      >
        <span className="min-w-0 flex-1">{message}</span>
        {action && (
          <button
            type="button"
            className="min-h-11 shrink-0 font-medium text-primary underline underline-offset-2 md:min-h-0"
            onClick={() => {
              baseToast.dismiss(t.id);
              action.onClick();
            }}
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          className="min-h-11 shrink-0 text-muted-foreground hover:text-foreground md:min-h-0"
          onClick={() => baseToast.dismiss(t.id)}
        >
          ✕
        </button>
      </div>
    ),
    { duration: Number.POSITIVE_INFINITY, ...rest, id },
  );
}

export const toast = {
  success,
  error,
  custom: baseToast.custom,
  dismiss: baseToast.dismiss,
};
