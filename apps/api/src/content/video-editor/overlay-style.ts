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

export interface OverlayPalette {
  accent: string;
  ctaBg: string;
  ctaFg: string;
}

export function overlayPalette(primaryColor?: string | null): OverlayPalette {
  const hex = parseHexColor(primaryColor);
  if (!hex) {
    return {
      accent: 'white@0.88',
      ctaBg: 'white@0.94',
      ctaFg: 'black',
    };
  }
  const dark = isDarkHex(hex);
  return {
    accent: `0x${hex}@0.95`,
    ctaBg: `0x${hex}@0.94`,
    ctaFg: dark ? 'white' : 'black',
  };
}
