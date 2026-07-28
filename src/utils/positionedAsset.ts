/**
 * Selects a stable visual variant from a manuscript-grid position.
 * Using the same seed in the DOM preview and Canvas export keeps both views
 * visually identical without relying on Math.random.
 */
export function pickPositionedAsset(
  assets: readonly string[],
  row: number,
  column: number,
  length = 0,
): string {
  return assets[(row * 31 + column * 7 + length) % assets.length];
}
