import star1 from "../assets/handwrites/processed/star.png";
import star2 from "../assets/handwrites/processed/star2.png";

import { pickPositionedAsset } from "./positionedAsset";

const STAR_MARKS = [
  {
    url: star1,
    // Existing crayon stroke traced in the requested
    // 1(left) → 2(right) → 3(lower-left) → 4(top) → 5(lower-right) → 1 order.
    path: "M 25 52 L 85 31 L 32 89 L 58 12 L 66 86 L 25 52",
  },
  {
    url: star2,
    path: "M 20 41 L 88 29 L 31 83 L 54 10 L 61 92 L 20 41",
  },
] as const;

/** Star URLs that must be preloaded before the canvas export is drawn. */
export const STAR_MARK_URLS = STAR_MARKS.map(({ url }) => url);

export interface StarPlacement {
  row: number;
  column: number;
}

export interface StarMarkDefinition {
  url: string;
  path: string;
}

export function pickStarMark(row: number, column: number): StarMarkDefinition {
  return pickPositionedAsset(STAR_MARKS, row, column);
}

/**
 * Selects a star variant with a position-based seed. This looks varied while
 * ensuring the DOM preview and canvas export always choose the same asset.
 */
export function pickStarMarkAsset(row: number, column: number): string {
  return pickStarMark(row, column).url;
}

function findCharacters(
  content: string[],
  target: string[],
  occupied: Set<number>,
): number {
  for (let start = 0; start <= content.length - target.length; start += 1) {
    if (
      target.every(
        (character, offset) =>
          content[start + offset] === character &&
          !occupied.has(start + offset),
      )
    ) {
      return start;
    }
  }
  return -1;
}

/**
 * Places one star at the upper-left of the first character of each praised
 * expression. Newlines advance to the next manuscript row, and code points
 * (rather than UTF-16 indexes) keep emoji aligned to a single grid cell.
 */
export function buildStarPlacements(
  content: string,
  starWords: string[],
  columnCount: number,
  visibleCellCount: number,
): StarPlacement[] {
  const characters = Array.from(content);
  const sourceToCell = new Map<number, number>();
  const occupied = new Set<number>();
  let cellIndex = 0;

  characters.forEach((character, sourceIndex) => {
    if (character === "\n") {
      const remainder = cellIndex % columnCount;
      if (remainder !== 0) {
        cellIndex += columnCount - remainder;
      }
      return;
    }
    sourceToCell.set(sourceIndex, cellIndex);
    cellIndex += 1;
  });

  const placements: StarPlacement[] = [];
  for (const word of starWords) {
    const target = Array.from(word);
    if (target.length === 0) continue;

    const start = findCharacters(characters, target, occupied);
    if (start < 0) continue;

    for (let offset = 0; offset < target.length; offset += 1) {
      occupied.add(start + offset);
    }

    const targetCell = sourceToCell.get(start);
    if (targetCell === undefined || targetCell >= visibleCellCount) continue;

    const column = targetCell % columnCount;
    placements.push({
      row: Math.floor(targetCell / columnCount),
      column,
    });
  }

  return placements.filter(
    (placement, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.row === placement.row &&
          candidate.column === placement.column,
      ) === index,
  );
}
