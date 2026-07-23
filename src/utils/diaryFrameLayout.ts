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
  maxRows: 10,
  rowHeight: 68,
  topHeight: 947,
  bottomSourceY: 1287,
  header: { x: 50, y: 205, width: 959, height: 81 },
  title: { x: 129, y: 286, width: 879, height: 73 },
  photo: { x: 45, y: 361, width: 968, height: 561 },
  content: { x: 45, y: 947, width: 968 },
  comment: { x: 44, y: 1312, width: 970, height: 140 },
} as const;

// The product limit is exactly 100 characters. The 11-column manuscript grid
// needs a tenth row for the final character, leaving the unused cells blank.
export const CONTENT_MAX_LENGTH = 100;

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
