import { findProfanityMatches } from "./profanity";

export interface ProfanityReplacement {
  original: string;
  replacement: string;
}

export function applyProfanityReplacements(
  content: string,
  replacements: readonly ProfanityReplacement[],
): string {
  return [...replacements]
    .sort(
      (left, right) =>
        Array.from(right.original).length - Array.from(left.original).length,
    )
    .reduce(
      (result, { original, replacement }) =>
        result.split(original).join(replacement),
      content,
    );
}

export function buildFallbackProfanityReplacements(
  content: string,
): ProfanityReplacement[] {
  const seen = new Set<string>();

  return findProfanityMatches(content).flatMap(({ start, end }) => {
    // AIDEV-NOTE: findProfanityMatches의 start/end는 UTF-16 인덱스이며 end는 inclusive다.
    const original = content.slice(start, end + 1);
    if (original === "" || seen.has(original)) {
      return [];
    }
    seen.add(original);
    return [
      {
        original,
        replacement: Array.from(original).length === 1 ? "참" : "별로",
      },
    ];
  });
}
