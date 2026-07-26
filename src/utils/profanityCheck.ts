import { findProfanityMatches } from "./profanity";

export interface ProfanityCheckRun {
  row: number;
  startColumn: number;
  length: number;
}

interface IndexedProfanityCheckRun extends ProfanityCheckRun {
  matchIndex: number;
}

export function buildProfanityCheckRuns(
  content: string,
  columnCount: number,
  maxCellCount: number,
): ProfanityCheckRun[] {
  const matches = findProfanityMatches(content);
  const runs: IndexedProfanityCheckRun[] = [];
  let cellIndex = 0;
  let sourceIndex = 0;
  let matchIndex = 0;

  for (const character of content) {
    while (
      matches[matchIndex] !== undefined &&
      matches[matchIndex].end < sourceIndex
    ) {
      matchIndex += 1;
    }

    if (character === "\n") {
      while (cellIndex % columnCount !== 0) {
        cellIndex += 1;
      }
      sourceIndex += character.length;
      continue;
    }

    if (cellIndex >= maxCellCount) {
      break;
    }

    const match = matches[matchIndex];
    const characterEnd = sourceIndex + character.length - 1;
    if (
      match !== undefined &&
      sourceIndex <= match.end &&
      characterEnd >= match.start
    ) {
      const row = Math.floor(cellIndex / columnCount);
      const column = cellIndex % columnCount;
      const previous = runs[runs.length - 1];

      if (
        previous !== undefined &&
        previous.matchIndex === matchIndex &&
        previous.row === row &&
        previous.startColumn + previous.length === column
      ) {
        previous.length += 1;
      } else {
        runs.push({
          matchIndex,
          row,
          startColumn: column,
          length: 1,
        });
      }
    }

    cellIndex += 1;
    sourceIndex += character.length;
  }

  return runs.map(({ row, startColumn, length }) => ({
    row,
    startColumn,
    length,
  }));
}
