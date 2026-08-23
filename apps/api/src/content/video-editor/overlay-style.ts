export function parseHexColor(value?: string | null): string | null {
  const raw = value?.trim() ?? '';
  const six = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (six) return six[1].toUpperCase();
  const three = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (!three) return null;
  return three[1]
    .split('')
    .map((char) => `${char}${char}`)
    .join('')
    .toUpperCase();
}

export function isDarkHex(hex: string): boolean {
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return true;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}

export const CTA_RED_HEX = 'E11D2E';
export const CTA_HAND_EMOJI = '👇';
export const CTA_HAND_FALLBACK = '▼';

export interface OverlayPalette {
  accent: string;
  ctaBg: string;
  ctaFg: string;
  ctaShadow: string;
  ctaRing: string;
}

export function overlayPalette(primaryColor?: string | null): OverlayPalette {
  const hex = parseHexColor(primaryColor);
  return {
    accent: hex ? `0x${hex}@0.95` : 'white@0.88',
    ctaBg: `0x${CTA_RED_HEX}@0.96`,
    ctaFg: 'white',
    ctaShadow: '0x6B0C16@0.62',
    ctaRing: 'white@0.92',
  };
}
