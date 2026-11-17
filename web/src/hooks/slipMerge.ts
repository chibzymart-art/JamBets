import type { FavoritePredictionItem } from '../components/FavoritesDrawer';

export interface SlipState {
  items: FavoritePredictionItem[];
  ids: string[];
}

/** Union of two slips: every pick from both (by id, first copy wins), every fixture id once. */
export function mergeSlips(a: SlipState, b: SlipState): SlipState {
  const seen = new Set<string>();
  const items: FavoritePredictionItem[] = [];
  for (const it of [...a.items, ...b.items]) {
    if (!it || typeof it.id !== 'string' || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  const ids = Array.from(new Set([...a.ids, ...b.ids].filter((x) => typeof x === 'string')));
  return { items: items.slice(0, 200), ids: ids.slice(0, 500) };
}
