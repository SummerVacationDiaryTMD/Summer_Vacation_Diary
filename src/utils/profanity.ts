interface CompactContent {
  value: string;
  sourceIndexes: number[];
}

export interface ProfanityMatch {
  start: number;
  end: number;
}

/**
 * 초성 표현과 특수한 우회 표기는 제외합니다.
 *
 * 포함 예시:
 * - 일반적인 한국어 강한 욕설
 * - 일반적인 철자·발음 변형
 * - 영어 강한 욕설
 *
 * 제외 예시:
 * - ㅅㅂ, ㅂㅅ, ㅈㄴ 등의 초성
 * - 숫자나 기호를 글자처럼 사용하는 특수 치환
 * - 바보, 멍청이 등의 비교적 약한 표현
 */
const PROFANITY_WORDS = [
  // 한국어: 씨발 계열
  "개씨발새끼",
  "개씨발년",
  "개씨발놈",
  "개씨발",
  "씨발새끼",
  "씨발년",
  "씨발놈",
  "씨발련",
  "씨발",
  "시발새끼",
  "시발년",
  "시발놈",
  "시발련",
  "시발",
  "씨팔",
  "시팔",
  "씨벌",
  "시벌",
  "씨바",
  "시바",

  // 한국어: 씹 계열
  "씹새끼",
  "씹년",
  "씹놈",
  "씹창",
  "씹덕",
  "씹빨",
  "씹할",
  "씹",

  // 한국어: 좆 계열
  "좆병신",
  "좆대가리",
  "좆같은년",
  "좆같은놈",
  "좆같다",
  "좆같네",
  "좆같",
  "좆까라",
  "좆까",
  "좆밥",
  "좆망",
  "좆나",
  "좆",

  // 한국어: 개새끼·비하 계열
  "개새끼",
  "개색기",
  "개세끼",
  "개쉐끼",
  "개새",
  "개자식",
  "개잡놈",
  "개잡년",
  "개잡종",
  "개같은년",
  "개같은놈",
  "개같다",
  "개같네",
  "개같",
  "개년",
  "개놈",

  // 한국어: 병신 계열
  "병신새끼",
  "병신같은년",
  "병신같은놈",
  "병신같다",
  "병신같네",
  "병신같",
  "병신",
  "븅신",
  "빙신",
  "볍신",
  "븅",
  "븁",

  // 한국어: 미친 표현
  "미친새끼",
  "미친년",
  "미친놈",
  "미친련",
  "미친자식",

  // 한국어: 가족을 이용한 심한 욕설
  "니애미",
  "니애비",
  "니에미",
  "니에비",
  "네애미",
  "네애비",
  "느금마",
  "느금",
  "너거미",
  "니미",
  "애미뒤진",
  "애비뒤진",
  "부모없는새끼",
  "후레자식",
  "호로자식",
  "호로새끼",

  // 한국어: 성적 비하·모욕
  "창녀",
  "창년",
  "창놈",
  "걸레년",
  "걸레같은년",
  "걸레같",
  "몸파는년",
  "몸파는놈",
  "암캐",
  "갈보",
  "잡년",
  "잡놈",

  // 한국어: 기타 강한 모욕
  "고아새끼",
  "고아련",
  "염병할",
  "염병",
  "지랄맞",
  "지랄하",
  "지랄",
  "존나",
  "존내",
  "존니",
  "존라",
  "엿먹어",
  "엿먹",
  "꺼져버려",
  "닥쳐",
  "죽어버려",

  // 영어: fuck 계열
  "motherfucking",
  "motherfucker",
  "motherfuckers",
  "fucking",
  "fucker",
  "fuckers",
  "fuckface",
  "fuckhead",
  "fuckoff",
  "fuckyou",
  "fuck",

  // 영어: shit 계열
  "bullshitting",
  "bullshit",
  "shithead",
  "shitface",
  "shitbag",
  "shitty",
  "shitting",
  "shit",

  // 영어: bitch 계열
  "sonofabitch",
  "bitches",
  "bitching",
  "bitch",

  // 영어: 일반적인 강한 모욕
  "assholes",
  "asshole",
  "arsehole",
  "bastards",
  "bastard",
  "dumbass",
  "jackass",
  "dipshit",
  "dickhead",
  "dickface",
  "douchebag",
  "scumbag",
  "pieceofshit",
  "prick",
  "cunt",
  "cunts",
  "dick",

  // 영어: 성적 비하
  "cocksucker",
  "slut",
  "sluts",
  "whore",
  "whores",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 긴 표현을 먼저 검사합니다.
 *
 * 예:
 * "개씨발새끼"에서 "개씨발"만 먼저 매칭되는 일을 방지합니다.
 */
const PROFANITY_PATTERN = new RegExp(
  [...PROFANITY_WORDS]
    .sort((first, second) => second.length - first.length)
    .map(escapeRegExp)
    .join("|"),
  "gu",
);

function compactContent(value: string): CompactContent {
  let compact = "";
  const sourceIndexes: number[] = [];

  /**
   * UTF-16 인덱스를 직접 관리합니다.
   *
   * Array.from(value)의 배열 인덱스를 사용하면 욕설 앞에 이모지가 있을 때
   * 원본 문자열 인덱스와 어긋날 수 있습니다.
   */
  let sourceIndex = 0;

  for (const character of value) {
    const normalized = character.normalize("NFKC").toLowerCase();

    for (const normalizedCharacter of normalized) {
      if (/[\p{L}\p{N}]/u.test(normalizedCharacter)) {
        compact += normalizedCharacter;

        /**
         * 정규화된 문자가 UTF-16에서 두 칸을 차지하는 경우에도
         * 각 코드 유닛이 원본 문자 위치를 가리키도록 저장합니다.
         */
        for (
          let normalizedIndex = 0;
          normalizedIndex < normalizedCharacter.length;
          normalizedIndex += 1
        ) {
          sourceIndexes.push(sourceIndex);
        }
      }
    }

    sourceIndex += character.length;
  }

  return {
    value: compact,
    sourceIndexes,
  };
}

export function findProfanityMatches(value: string): ProfanityMatch[] {
  const compact = compactContent(value);
  const matches: ProfanityMatch[] = [];

  for (const match of compact.value.matchAll(PROFANITY_PATTERN)) {
    if (match.index === undefined || match[0] === "") {
      continue;
    }

    const compactStart = match.index;
    const compactEnd = compactStart + match[0].length - 1;

    const start = compact.sourceIndexes[compactStart];
    const endSourceIndex = compact.sourceIndexes[compactEnd];

    if (start === undefined || endSourceIndex === undefined) {
      continue;
    }

    /**
     * end는 마지막 문자까지 포함하는 inclusive 인덱스입니다.
     * 현재 욕설 목록은 한글과 기본 영문 중심이므로 마지막 문자는 대부분
     * UTF-16 한 칸이지만, 안전하게 원본 코드 포인트 길이를 반영합니다.
     */
    const lastCharacter = String.fromCodePoint(
      value.codePointAt(endSourceIndex) ?? 0,
    );

    const end = endSourceIndex + lastCharacter.length - 1;

    matches.push({
      start,
      end,
    });
  }

  return mergeOverlappingMatches(matches);
}

function mergeOverlappingMatches(matches: ProfanityMatch[]): ProfanityMatch[] {
  if (matches.length <= 1) {
    return matches;
  }

  const sortedMatches = [...matches].sort(
    (first, second) => first.start - second.start || first.end - second.end,
  );

  const mergedMatches: ProfanityMatch[] = [];

  for (const currentMatch of sortedMatches) {
    const previousMatch = mergedMatches[mergedMatches.length - 1];

    if (previousMatch && currentMatch.start <= previousMatch.end + 1) {
      previousMatch.end = Math.max(previousMatch.end, currentMatch.end);
      continue;
    }

    mergedMatches.push({
      ...currentMatch,
    });
  }

  return mergedMatches;
}

export function findProfanityCharacterIndexes(value: string): Set<number> {
  const indexes = new Set<number>();

  for (const match of findProfanityMatches(value)) {
    /**
     * compactContent에서 제거된 공백과 문장부호도 매칭 범위에 포함합니다.
     *
     * 예:
     * "씨 발", "f.u.c.k"처럼 입력하면 목록에 우회 표현을 따로 넣지
     * 않아도 하나의 연속된 교정 범위로 표시됩니다.
     */
    for (
      let sourceIndex = match.start;
      sourceIndex <= match.end;
      sourceIndex += 1
    ) {
      indexes.add(sourceIndex);
    }
  }

  return indexes;
}

export function containsProfanity(value: string): boolean {
  return findProfanityMatches(value).length > 0;
}
