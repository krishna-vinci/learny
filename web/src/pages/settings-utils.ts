// Pure helpers for SettingsPage, kept separate so they're trivially unit-testable.

export interface ModelGroup {
  provider: string;
  models: string[];
}

/**
 * Groups `available` model ids (shape `provider/id`, per the `/api/settings` contract) into
 * per-provider buckets, preserving first-seen order — ready for rendering as `<optgroup>`s.
 * An id with no `/` is bucketed under "other" rather than dropped.
 */
export function groupModelsByProvider(available: string[]): ModelGroup[] {
  const order: string[] = [];
  const byProvider = new Map<string, string[]>();

  for (const entry of available) {
    const slashIndex = entry.indexOf("/");
    const provider = slashIndex === -1 ? "other" : entry.slice(0, slashIndex);
    let models = byProvider.get(provider);
    if (!models) {
      models = [];
      byProvider.set(provider, models);
      order.push(provider);
    }
    models.push(entry);
  }

  return order.map((provider) => ({ provider, models: byProvider.get(provider) ?? [] }));
}
