const CORRECTION_MESSAGES = [
  "설마 욕한 거예요?",
  "이러면 안 돼요",
  "고운 말을 씁시다",
  "예쁜 말로 바꿔 써요",
  "친구가 속상해요",
  "다른 말로 표현해 봐요",
  "마음을 차분히 적어 봐요",
  "서로 존중하는 말을 써요",
  "말에도 마음이 담겨요",
  "기분 좋은 말을 골라 봐요",
  "우리 반 약속을 기억해요",
  "상대방을 생각하며 써요",
  "조금 더 다정하게 말해요",
  "화난 마음은 말로 풀어 봐요",
  "읽는 사람의 마음도 생각해요",
  "선생님은 고운 말이 좋아요",
] as const;

interface ProfanityCell {
  profanityMatchIndex: number | null;
}

export type ProfanityDecoration =
  | "underline"
  | "double-underline"
  | "cross"
  | "check";

const PROFANITY_DECORATIONS: readonly ProfanityDecoration[] = [
  "underline",
  "cross",
  "double-underline",
  "check",
  "underline",
  "cross",
];

export interface ProfanityCorrectionRun {
  row: number;
  startColumn: number;
  length: number;
  showMessage: boolean;
  decoration: ProfanityDecoration;
  message: (typeof CORRECTION_MESSAGES)[number];
}

export function buildProfanityCorrectionRuns(
  cells: readonly ProfanityCell[],
  columnCount: number,
): ProfanityCorrectionRun[] {
  const runs: ProfanityCorrectionRun[] = [];

  cells.forEach((cell, index) => {
    if (cell.profanityMatchIndex === null) return;

    const row = Math.floor(index / columnCount);
    const column = index % columnCount;
    const previous = runs[runs.length - 1];
    if (
      previous !== undefined &&
      cells[index - 1]?.profanityMatchIndex === cell.profanityMatchIndex &&
      previous.row === row &&
      previous.startColumn + previous.length === column
    ) {
      previous.length += 1;
      return;
    }

    const messageIndex =
      (cell.profanityMatchIndex * 11 + row * 17 + column * 7) %
      CORRECTION_MESSAGES.length;
    const decorationIndex =
      (cell.profanityMatchIndex * 5 + row * 3 + column + index) %
      PROFANITY_DECORATIONS.length;
    runs.push({
      row,
      startColumn: column,
      length: 1,
      showMessage: false,
      decoration: PROFANITY_DECORATIONS[decorationIndex],
      message: CORRECTION_MESSAGES[messageIndex],
    });
  });

  cells.forEach((cell, index) => {
    if (
      cell.profanityMatchIndex === null ||
      cells[index + 1]?.profanityMatchIndex === cell.profanityMatchIndex
    ) {
      return;
    }
    const row = Math.floor(index / columnCount);
    const column = index % columnCount;
    const finalRun = runs.find(
      (run) =>
        run.row === row &&
        column >= run.startColumn &&
        column < run.startColumn + run.length,
    );
    if (finalRun !== undefined) finalRun.showMessage = true;
  });

  return runs;
}
