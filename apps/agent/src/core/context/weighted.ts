export interface WeightedItem<T> {
  item: T;
  weight: number;
}

export function pickWeighted<T>(
  items: Array<{ weight?: number | null; item: T }>,
  rng: () => number,
): T | null {
  if (items.length === 0) return null;
  const normalized = items.map((i) => ({ ...i, weight: i.weight ?? 1 }));
  const total = normalized.reduce((s, i) => s + i.weight, 0);
  if (total <= 0) {
    const first = normalized[0];
    return first ? first.item : null;
  }
  let rand = rng() * total;
  for (const { item, weight } of normalized) {
    rand -= weight;
    if (rand <= 0) return item;
  }
  const last = normalized[normalized.length - 1];
  return last ? last.item : null;
}

export interface VariantItem {
  flowNs: string;
  slugId: string | null;
  variantGroup: string | null;
  weight: number | null;
}

export interface SentRecord {
  slugId: string;
  sentAt: Date;
}

export interface CollapsedVariant {
  flowNs: string;
  slugId: string | null;
  variantGroup: string | null;
  timesSent: number;
  lastSent: Date | null;
}

/** Collapse variant groups: pick one representative per group, aggregate sent stats. */
export function collapseVariantGroups(
  variants: VariantItem[],
  sentMap: Map<string, SentRecord>,
  rng: () => number,
): CollapsedVariant[] {
  const groups = new Map<string, VariantItem[]>();
  const singletons: VariantItem[] = [];

  for (const v of variants) {
    if (v.variantGroup) {
      const g = groups.get(v.variantGroup) ?? [];
      g.push(v);
      groups.set(v.variantGroup, g);
    } else {
      singletons.push(v);
    }
  }

  const result: CollapsedVariant[] = [];

  // Singletons pass through directly
  for (const v of singletons) {
    const sent = v.slugId ? sentMap.get(v.slugId) : undefined;
    result.push({
      flowNs: v.flowNs,
      slugId: v.slugId,
      variantGroup: null,
      timesSent: sent ? 1 : 0,
      lastSent: sent?.sentAt ?? null,
    });
  }

  // Groups: pick a representative, aggregate sent stats across the whole group
  for (const [group, members] of groups.entries()) {
    const picked = pickWeighted(
      members.map((m) => ({ item: m, weight: m.weight ?? 1 })),
      rng,
    );
    if (!picked) continue;

    // Aggregate times_sent: count distinct slugIds in this group that appear in sentMap
    let timesSent = 0;
    let lastSent: Date | null = null;
    for (const m of members) {
      if (!m.slugId) continue;
      const s = sentMap.get(m.slugId);
      if (s) {
        timesSent++;
        if (!lastSent || s.sentAt > lastSent) lastSent = s.sentAt;
      }
    }

    result.push({
      flowNs: picked.flowNs,
      slugId: picked.slugId,
      variantGroup: group,
      timesSent,
      lastSent,
    });
  }

  return result;
}
