import type { DiaryFrameLayout } from "../utils/diaryFrameLayout";

interface DiaryFrameBackgroundProps {
  layout: DiaryFrameLayout;
}

/** Displays the fixed Instagram 4:5 frame with its exact 13 × 5 grid. */
export function DiaryFrameBackground(_props: DiaryFrameBackgroundProps) {
  void _props;
  return (
    <div className="diary-frame-background" aria-hidden />
  );
}
