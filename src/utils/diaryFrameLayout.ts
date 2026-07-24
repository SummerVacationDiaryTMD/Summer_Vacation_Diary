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
  baseHeight: 1323,
  columns: 13,
  baseRows: 5,
  maxRows: 5,
  rowHeight: 959 / 13,
  topHeight: 785,
  bottomSourceY: 1154,
  header: { x: 50, y: 238, width: 959, height: 82 },
  title: { x: 149, y: 320, width: 859, height: 72 },
  photo: { x: 48, y: 393, width: 960, height: 358 },
  content: { x: 48, y: 785, width: 959 },
  comment: { x: 48, y: 1180, width: 960, height: 108 },
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
