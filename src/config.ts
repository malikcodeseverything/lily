export type Quality = 'low' | 'medium' | 'high';

export const QUALITY_POINTS: Record<Quality, number> = {
  low: 70_000,
  medium: 140_000,
  high: 220_000,
};

export interface AppOptions {
  quality: Quality;
  startShape: string | null;
  mirror: boolean;
  showBox: boolean;
  glow: boolean;
  debug: boolean;
}

/** Sensible defaults, overridable with URL params (?q=high&shape=tree). */
export function readOptions(search = location.search): AppOptions {
  const p = new URLSearchParams(search);
  const q = p.get('q');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const auto: Quality = coarse || cores <= 4 ? 'low' : 'medium';
  return {
    quality: q === 'low' || q === 'medium' || q === 'high' ? q : auto,
    startShape: p.get('shape'),
    mirror: p.get('mirror') !== '0',
    showBox: p.get('box') !== '0',
    glow: p.get('glow') !== '0',
    debug: p.has('debug'),
  };
}

/** Render styles cycled with the rock sign or the S key. */
export const STYLES = ['Natural', 'Hologram', 'Thermal', 'Ember'] as const;
