import {
  DIARY_COMMENT,
  DIARY_FRAME,
  type DiaryFrameLayout,
} from "../utils/diaryFrameLayout";

interface DiaryFrameBackgroundProps {
  layout: DiaryFrameLayout;
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function containerWidth(value: number): string {
  return `${(value / DIARY_FRAME.width) * 100}cqw`;
}

/** Reassembles the original frame without vertically stretching its artwork. */
export function DiaryFrameBackground({ layout }: DiaryFrameBackgroundProps) {
  const bottomTopHeight =
    DIARY_COMMENT.bottomSplitSourceY - DIARY_FRAME.bottomSourceY;
  const bottomTailHeight =
    DIARY_FRAME.baseHeight - DIARY_COMMENT.bottomSplitSourceY;
  const extensionSlices = Math.ceil(
    layout.commentExtraHeight / DIARY_COMMENT.extensionSliceHeight,
  );

  return (
    <div className="diary-frame-background" aria-hidden>
      <div
        className="diary-frame-top"
        style={{ height: percent(layout.topHeight, layout.height) }}
      />
      <div
        className="diary-frame-grid"
        style={{
          top: percent(layout.topHeight, layout.height),
          height: percent(layout.content.height, layout.height),
          gridTemplateRows: `repeat(${layout.contentRows}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: layout.contentRows }, (_, index) => (
          <span className="diary-frame-grid-row" key={index} />
        ))}
      </div>
      <div
        className="diary-frame-bottom-piece"
        style={{
          top: percent(layout.bottomTop, layout.height),
          height: percent(bottomTopHeight, layout.height),
          backgroundPosition: `center -${containerWidth(
            DIARY_FRAME.bottomSourceY,
          )}`,
        }}
      />
      {Array.from({ length: extensionSlices }, (_, index) => {
        const sliceHeight = Math.min(
          DIARY_COMMENT.extensionSliceHeight,
          layout.commentExtraHeight -
            index * DIARY_COMMENT.extensionSliceHeight,
        );
        return (
          <div
            className="diary-frame-bottom-piece"
            key={index}
            style={{
              top: percent(
                layout.bottomTop +
                  bottomTopHeight +
                  index * DIARY_COMMENT.extensionSliceHeight,
                layout.height,
              ),
              height: percent(sliceHeight, layout.height),
              backgroundPosition: `center -${containerWidth(
                DIARY_COMMENT.extensionSourceY,
              )}`,
            }}
          />
        );
      })}
      <div
        className="diary-frame-bottom-piece"
        style={{
          top: percent(
            layout.bottomTop + bottomTopHeight + layout.commentExtraHeight,
            layout.height,
          ),
          height: percent(bottomTailHeight, layout.height),
          backgroundPosition: `center -${containerWidth(
            DIARY_COMMENT.bottomSplitSourceY,
          )}`,
        }}
      />
    </div>
  );
}
