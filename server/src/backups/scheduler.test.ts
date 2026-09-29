import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupCheckRecord, BackupRunRecord, BackupSettings } from "./config.js";
import { BackupScheduler, type BackupService, isMonthlyCheckDay, nextRunDelay } from "./scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("backup schedule helpers", () => {
  it("computes the delay to the next local HH:MM", () => {
    expect(nextRunDelay(new Date(2026, 8, 29, 3, 29, 0), "03:30")).toBe(60_000);
    // 03:31 is past today's slot, so the next run is tomorrow.
    expect(nextRunDelay(new Date(2026, 8, 29, 3, 31, 0), "03:30")).toBe(23 * 60 * 60_000 + 59 * 60_000);
    // A malformed time falls back to the documented default.
    expect(nextRunDelay(new Date(2026, 8, 29, 3, 29, 0), "nope")).toBe(60_000);
  });

  it("treats the 1st of the month as the integrity check day", () => {
    expect(isMonthlyCheckDay(new Date(2026, 9, 1, 3, 30))).toBe(true);
    expect(isMonthlyCheckDay(new Date(2026, 9, 2, 3, 30))).toBe(false);
  });
});

interface StubService {
  settings(): BackupSettings;
  runBackup(): Promise<BackupRunRecord>;
  runCheck(): Promise<BackupCheckRecord>;
  onConfigChange(listener: () => void): () => void;
}

function stubService(state: { enabled: boolean; time: string }): { service: BackupService; calls: string[] } {
  const calls: string[] = [];
  const settings = (): BackupSettings => ({
    destination: null,
    repoPassword: null,
    schedule: { enabled: state.enabled, time: state.time },
    retention: { daily: 7, weekly: 4, monthly: 12 },
    lastRun: null,
    lastCheck: null,
  });
  const stub: StubService = {
    settings,
    runBackup: async () => {
      calls.push("backup");
      return { at: new Date().toISOString(), ok: true, message: "backup completed" };
    },
    runCheck: async () => {
      calls.push("check");
      return { at: new Date().toISOString(), ok: true, message: "repository check passed" };
    },
    onConfigChange: () => () => undefined,
  };
  return { service: stub as unknown as BackupService, calls };
}

describe("BackupScheduler", () => {
  it("fires a backup at the configured time and reschedules for the next day", async () => {
    vi.useFakeTimers();
    const { service, calls } = stubService({ enabled: true, time: "03:30" });
    let now = new Date(2026, 8, 29, 3, 29, 0);
    const scheduler = new BackupScheduler({ service, now: () => now });
    scheduler.start();

    now = new Date(2026, 8, 29, 3, 30, 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(["backup"]);

    now = new Date(2026, 8, 30, 3, 30, 0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(calls).toEqual(["backup", "backup"]);

    scheduler.stop();
    now = new Date(2026, 8, 31, 3, 30, 0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(calls).toEqual(["backup", "backup"]);
  });

  it("runs the monthly check after the backup on the 1st", async () => {
    vi.useFakeTimers();
    const { service, calls } = stubService({ enabled: true, time: "03:30" });
    let now = new Date(2026, 9, 1, 3, 29, 0);
    const scheduler = new BackupScheduler({ service, now: () => now });
    scheduler.start();

    now = new Date(2026, 9, 1, 3, 30, 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(["backup", "check"]);
    scheduler.stop();
  });

  it("does nothing while the schedule is disabled", async () => {
    vi.useFakeTimers();
    const { service, calls } = stubService({ enabled: false, time: "03:30" });
    let now = new Date(2026, 8, 29, 3, 29, 0);
    const scheduler = new BackupScheduler({ service, now: () => now });
    scheduler.start();

    now = new Date(2026, 8, 29, 3, 30, 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual([]);
    scheduler.stop();
  });
});
