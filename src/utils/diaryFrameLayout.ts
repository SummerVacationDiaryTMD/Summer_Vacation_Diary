export interface DiaryFrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiaryFrameLayout {
  width: number;
  height: number;
  contentRows: number;
  commentLines: number;
  commentExtraHeight: number;
  content: DiaryFrameRegion;
  comment: DiaryFrameRegion;
  topHeight: number;
  bottomTop: number;
}

/**
 * Pixel measurements from picture-diary-frame-instagram.png. Keeping one coordinate
 * system lets the DOM preview and the exported canvas share the same layout.
 */
export const DIARY_FRAME = {
  width: 1080,
  baseHeight: 1350,
  columns: 13,
  baseRows: 5,
  maxRows: 5,
  rowHeight: 76,
  topHeight: 835,
  bottomSourceY: 1215,
  header: { x: 45, y: 20, width: 990, height: 70 },
  title: { x: 150, y: 90, width: 700, height: 55 },
  photo: { x: 45, y: 155, width: 992, height: 660 },
  content: { x: 45, y: 835, width: 990 },
  comment: { x: 45, y: 1215, width: 990, height: 110 },
} as const;

export const DIARY_COMMENT = {
  paddingX: 25,
  lineHeight: 38,
  extensionSourceY: 1384,
  bottomSplitSourceY: 1400,
  extensionSliceHeight: 16,
} as const;

// The Instagram layout uses a fixed 13 × 5 manuscript grid.
export const CONTENT_MAX_LENGTH = 65;

/** Keeps typed content within the same 13×5 cells used by the preview. */
export function fitDiaryContent(content: string): string {
  const capacity = DIARY_FRAME.columns * DIARY_FRAME.maxRows;
  let usedCells = 0;
  let charactersSinceNewline = 0;
  let result = "";

  for (const character of Array.from(content)) {
    if (usedCells >= capacity) break;

    if (character === "\n") {
      usedCells +=
        charactersSinceNewline === 0
          ? DIARY_FRAME.columns
          : (DIARY_FRAME.columns - (usedCells % DIARY_FRAME.columns)) %
            DIARY_FRAME.columns;
      charactersSinceNewline = 0;
    } else {
      usedCells += 1;
      charactersSinceNewline += 1;
    }
    result += character;
  }

  return result;
}

export function diaryContentCellCount(content: string): number {
  let usedCells = 0;
  let charactersSinceNewline = 0;

  for (const character of Array.from(fitDiaryContent(content))) {
    if (character === "\n") {
      usedCells +=
        charactersSinceNewline === 0
          ? DIARY_FRAME.columns
          : (DIARY_FRAME.columns - (usedCells % DIARY_FRAME.columns)) %
            DIARY_FRAME.columns;
      charactersSinceNewline = 0;
    } else {
      usedCells += 1;
      charactersSinceNewline += 1;
    }
  }

  return usedCells;
}

export function getDiaryFrameLayout(
  content: string,
  commentLines = 1,
): DiaryFrameLayout {
  void content;
  void commentLines;
  const contentRows = DIARY_FRAME.baseRows;
  const commentExtraHeight = 0;
  const height = DIARY_FRAME.baseHeight;
  const contentHeight = contentRows * DIARY_FRAME.rowHeight;
  const bottomTop = DIARY_FRAME.topHeight + contentHeight;

  return {
    width: DIARY_FRAME.width,
    height,
    contentRows,
    commentLines: 1,
    commentExtraHeight,
    content: {
      ...DIARY_FRAME.content,
      height: contentHeight,
    },
    comment: {
      ...DIARY_FRAME.comment,
      height: DIARY_FRAME.comment.height,
    },
    topHeight: DIARY_FRAME.topHeight,
    bottomTop,
  };
}
