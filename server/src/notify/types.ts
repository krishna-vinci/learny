/** One notification as delivered to a channel (ntfy or Web Push). */
export interface NotificationPayload {
  title: string;
  body: string;
  /** Absolute URL the click opens. */
  url?: string;
  /** ntfy tag names; defaults to a single bell. */
  tags?: string[];
}

/** Per-event opt-ins a user can toggle in Settings. */
export type NotificationEvent = "jobDone" | "jobFailed";

export interface NotificationEventSettings {
  jobDone: boolean;
  jobFailed: boolean;
}

export const DEFAULT_NOTIFICATION_EVENTS: NotificationEventSettings = { jobDone: true, jobFailed: true };
