import type { DiaryFrameLayout } from "../utils/diaryFrameLayout";

interface DiaryFrameBackgroundProps {
  layout: DiaryFrameLayout;
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

/** Reassembles the original frame without vertically stretching its artwork. */
export function DiaryFrameBackground({ layout }: DiaryFrameBackgroundProps) {
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
        className="diary-frame-bottom"
        style={{
          top: percent(layout.bottomTop, layout.height),
          height: percent(layout.bottomHeight, layout.height),
        }}
      />
    </div>
  );
}
