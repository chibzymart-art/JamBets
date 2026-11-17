import type { CSSProperties } from 'react';
import { itemByKey, type VlAvatarSlots, type VlItem } from './vlifeRules';

/** Where worn gear sits on the figure. */
const GEAR_SPOT: Record<string, 'hat' | 'face' | 'neck' | 'hand'> = {
  gear_cap: 'hat',
  gear_tophat: 'hat',
  gear_crown: 'hat',
  gear_shades: 'face',
  gear_scarf: 'neck',
  gear_horn: 'hand',
  gear_drum: 'hand',
};

/**
 * The fan figure, drawn with CSS: face emoji on top of a shirt in the kit's colours, with gear and
 * a badge pinned to the chest. Purely visual.
 */
export function VlAvatar({
  slots,
  catalog,
  size = 'md',
}: {
  slots: VlAvatarSlots;
  catalog: readonly VlItem[];
  size?: 'sm' | 'md' | 'lg';
}) {
  const base = itemByKey(catalog, slots.base);
  const kit = itemByKey(catalog, slots.kit);
  const gear = itemByKey(catalog, slots.gear);
  const badge = itemByKey(catalog, slots.badge);
  const spot = gear ? GEAR_SPOT[gear.key] ?? 'hand' : null;
  const style = {
    '--vl-kit1': kit?.colour1 ?? '#f8fafc',
    '--vl-kit2': kit?.colour2 ?? '#cbd5e1',
  } as CSSProperties;

  return (
    <div className={`vl-fig vl-fig--${size}`} style={style} aria-hidden="true">
      <div className="vl-fig-head">
        <span className="vl-fig-face">{base?.emoji ?? '🙂'}</span>
        {gear && spot !== 'hand' && spot !== 'neck' && <span className={`vl-fig-gear vl-fig-gear--${spot}`}>{gear.emoji}</span>}
      </div>
      <div className="vl-fig-body">
        <span className="vl-fig-stripe" />
        {gear && spot === 'neck' && <span className="vl-fig-gear vl-fig-gear--neck">{gear.emoji}</span>}
        {badge && <span className="vl-fig-badge">{badge.emoji}</span>}
        {gear && spot === 'hand' && <span className="vl-fig-gear vl-fig-gear--hand">{gear.emoji}</span>}
      </div>
    </div>
  );
}
