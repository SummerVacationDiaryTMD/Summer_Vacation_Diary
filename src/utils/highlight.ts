export interface HighlightSegment {
  text: string;
  mark: "circle" | "underline" | "both" | null;
}

interface Range {
  start: number;
  end: number;
  mark: "circle" | "underline";
}

/**
 * Splits diary content into plain and marked segments without injecting HTML.
 * Underline and circle ranges may overlap, so a word inside an underlined
 * sentence can render both correction marks.
 */
export function buildHighlightSegments(
  content: string,
  words: string[],
  sentence: string | null,
): HighlightSegment[] {
  const ranges: Range[] = [];
  const overlapsCircle = (start: number, end: number) =>
    ranges.some(
      (range) =>
        range.mark === "circle" && start < range.end && end > range.start,
    );

  if (sentence !== null && sentence !== "") {
    const index = content.indexOf(sentence);
    if (index >= 0) {
      ranges.push({
        start: index,
        end: index + sentence.length,
        mark: "underline",
      });
    }
  }

  for (const word of words) {
    if (word === "") {
      continue;
    }

    // Each circle target is used once, but it may overlap the underline.
    let index = content.indexOf(word);
    while (index >= 0 && overlapsCircle(index, index + word.length)) {
      index = content.indexOf(word, index + 1);
    }
    if (index < 0) {
      continue;
    }
    ranges.push({ start: index, end: index + word.length, mark: "circle" });
  }

  const boundaries = [
    ...new Set([
      0,
      content.length,
      ...ranges.flatMap(({ start, end }) => [start, end]),
    ]),
  ].sort((a, b) => a - b);

  const segments: HighlightSegment[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === end) continue;

    const activeRanges = ranges.filter(
      (range) => start < range.end && end > range.start,
    );
    const hasCircle = activeRanges.some((range) => range.mark === "circle");
    const hasUnderline = activeRanges.some(
      (range) => range.mark === "underline",
    );
    const mark =
      hasCircle && hasUnderline
        ? "both"
        : hasCircle
          ? "circle"
          : hasUnderline
            ? "underline"
            : null;

    const text = content.slice(start, end);
    const previous = segments[segments.length - 1];
    if (previous?.mark === mark) {
      previous.text += text;
    } else {
      segments.push({ text, mark });
    }
  }

  return segments;
}
