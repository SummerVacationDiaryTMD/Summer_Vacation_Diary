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
  content: DiaryFrameRegion;
  comment: DiaryFrameRegion;
  topHeight: number;
  bottomTop: number;
  bottomHeight: number;
}

/**
 * Pixel measurements from picture-diary-frame.png. Keeping one coordinate
 * system lets the DOM preview and the exported canvas share the same layout.
 */
export const DIARY_FRAME = {
  width: 1058,
  baseHeight: 1487,
  columns: 11,
  baseRows: 5,
  maxRows: 9,
  rowHeight: 69,
  topHeight: 880,
  bottomSourceY: 1225,
  header: { x: 50, y: 177, width: 959, height: 72 },
  title: { x: 129, y: 249, width: 879, height: 57 },
  photo: { x: 50, y: 316, width: 959, height: 544 },
  content: { x: 50, y: 880, width: 959 },
  comment: { x: 49, y: 1247, width: 961, height: 178 },
} as const;

export const CONTENT_MAX_LENGTH = DIARY_FRAME.columns * DIARY_FRAME.maxRows;

function countOccupiedCells(content: string): number {
  let cellCount = 0;

  for (const character of Array.from(content)) {
    if (character === "\n") {
      const remainder = cellCount % DIARY_FRAME.columns;
      if (remainder !== 0) {
        cellCount += DIARY_FRAME.columns - remainder;
      }
    } else {
      cellCount += 1;
    }
  }

  return cellCount;
}

export function getDiaryFrameLayout(content: string): DiaryFrameLayout {
  const requiredRows = Math.ceil(
    countOccupiedCells(content) / DIARY_FRAME.columns,
  );
  const contentRows = Math.min(
    DIARY_FRAME.maxRows,
    Math.max(DIARY_FRAME.baseRows, requiredRows),
  );
  const extraHeight =
    (contentRows - DIARY_FRAME.baseRows) * DIARY_FRAME.rowHeight;
  const height = DIARY_FRAME.baseHeight + extraHeight;
  const contentHeight = contentRows * DIARY_FRAME.rowHeight;
  const bottomTop = DIARY_FRAME.topHeight + contentHeight;

  return {
    width: DIARY_FRAME.width,
    height,
    contentRows,
    content: {
      ...DIARY_FRAME.content,
      height: contentHeight,
    },
    comment: {
      ...DIARY_FRAME.comment,
      y: DIARY_FRAME.comment.y + extraHeight,
    },
    topHeight: DIARY_FRAME.topHeight,
    bottomTop,
    bottomHeight: DIARY_FRAME.baseHeight - DIARY_FRAME.bottomSourceY,
  };
}
