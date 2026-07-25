import type { DiaryStamp } from "../services/diaryAnalysis";

export const STAMP_IMAGE_URLS: Record<DiaryStamp, string> = {
  great: "/stamps/great.png",
  effort: "/stamps/effort.png",
};

export const STAMP_ALT_TEXT: Record<DiaryStamp, string> = {
  great: "참 잘했어요 도장",
  effort: "좀 더 열심히 도장",
};
