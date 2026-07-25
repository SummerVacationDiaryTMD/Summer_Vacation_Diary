const PROFANITY_PATTERN =
  /(씨발|시발|개새끼|개새|병신|ㅈ같|좆|fuck|shit|욕설|니미|니애미|시발련|씹|개년|개씨발년|개씨발|볍신|고아련|창년|븁|븅|느금|너거미)/gu;

interface CompactContent {
  value: string;
  sourceIndexes: number[];
}

export interface ProfanityMatch {
  start: number;
  end: number;
}

function compactContent(value: string): CompactContent {
  let compact = "";
  const sourceIndexes: number[] = [];

  Array.from(value).forEach((character, sourceIndex) => {
    const normalized = character.normalize("NFKC").toLowerCase();
    for (const normalizedCharacter of Array.from(normalized)) {
      if (/[\p{L}\p{N}]/u.test(normalizedCharacter)) {
        compact += normalizedCharacter;
        sourceIndexes.push(sourceIndex);
      }
    }
  });

  return { value: compact, sourceIndexes };
}

export function findProfanityMatches(value: string): ProfanityMatch[] {
  const compact = compactContent(value);
  const matches: ProfanityMatch[] = [];

  for (const match of compact.value.matchAll(PROFANITY_PATTERN)) {
    if (match.index === undefined || match[0] === "") continue;

    const start = compact.sourceIndexes[match.index];
    const end = compact.sourceIndexes[match.index + match[0].length - 1];
    if (start === undefined || end === undefined) continue;

    matches.push({ start, end });
  }

  return matches;
}

export function findProfanityCharacterIndexes(value: string): Set<number> {
  const indexes = new Set<number>();
  for (const match of findProfanityMatches(value)) {
    // Include punctuation and spaces used to disguise a matched expression so
    // the preview draws one continuous correction instead of leaving gaps.
    for (let sourceIndex = match.start; sourceIndex <= match.end; sourceIndex += 1) {
      indexes.add(sourceIndex);
    }
  }
  return indexes;
}

export function containsProfanity(value: string): boolean {
  return findProfanityCharacterIndexes(value).size > 0;
}
