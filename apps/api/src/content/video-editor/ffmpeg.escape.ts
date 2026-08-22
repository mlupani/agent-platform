/** Escapa una ruta para usarla dentro de un filtergraph de FFmpeg (drawtext, movie). */
export function escapeFfmpegPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export function escapeDrawtextLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%');
}

export function isNearAspectRatio(
  width: number,
  height: number,
  expected = 9 / 16,
  tolerance = 0.03,
): boolean {
  if (!width || !height) return false;
  return Math.abs(width / height - expected) <= tolerance;
}
