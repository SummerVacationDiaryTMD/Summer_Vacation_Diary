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
 * Pixel measurements from picture-diary-frame.png. Keeping one coordinate
 * system lets the DOM preview and the exported canvas share the same layout.
 */
export const DIARY_FRAME = {
  width: 1058,
  baseHeight: 1487,
  columns: 11,
  baseRows: 5,
  maxRows: 10,
  rowHeight: 65.6,
  topHeight: 991,
  bottomSourceY: 1319,
  header: { x: 50, y: 238, width: 959, height: 82 },
  title: { x: 124, y: 320, width: 884, height: 72 },
  photo: { x: 48, y: 393, width: 960, height: 564 },
  content: { x: 48, y: 991, width: 959 },
  comment: { x: 48, y: 1344, width: 960, height: 108 },
} as const;

export const DIARY_COMMENT = {
  paddingX: 25,
  lineHeight: 34,
  tagExtraHeight: 18,
  extensionSourceY: 1384,
  bottomSplitSourceY: 1400,
  extensionSliceHeight: 16,
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

export function getDiaryFrameLayout(
  content: string,
  commentLines = 1,
  hasTags = false,
): DiaryFrameLayout {
  const requiredRows = Math.ceil(
    countOccupiedCells(content) / DIARY_FRAME.columns,
  );
  const contentRows = Math.min(
    DIARY_FRAME.maxRows,
    Math.max(DIARY_FRAME.baseRows, requiredRows),
  );
  const contentExtraHeight =
    (contentRows - DIARY_FRAME.baseRows) * DIARY_FRAME.rowHeight;
  const normalizedCommentLines = Math.max(1, commentLines);
  const commentExtraHeight =
    (normalizedCommentLines - 1) * DIARY_COMMENT.lineHeight +
    (hasTags ? DIARY_COMMENT.tagExtraHeight : 0);
  const height =
    DIARY_FRAME.baseHeight + contentExtraHeight + commentExtraHeight;
  const contentHeight = contentRows * DIARY_FRAME.rowHeight;
  const bottomTop = DIARY_FRAME.topHeight + contentHeight;

  return {
    width: DIARY_FRAME.width,
    height,
    contentRows,
    commentLines: normalizedCommentLines,
    commentExtraHeight,
    content: {
      ...DIARY_FRAME.content,
      height: contentHeight,
    },
    comment: {
      ...DIARY_FRAME.comment,
      y: DIARY_FRAME.comment.y + contentExtraHeight,
      height: DIARY_FRAME.comment.height + commentExtraHeight,
    },
    topHeight: DIARY_FRAME.topHeight,
    bottomTop,
  };
}
