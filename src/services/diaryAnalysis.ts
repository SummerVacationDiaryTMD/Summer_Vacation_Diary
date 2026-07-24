import { weatherLabel } from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import {
  EdgeFunctionError,
  invokeDiaryAi,
  isSupabaseConfigured,
} from "./supabaseEdge";

// ---------------------------------------------------------------------------
// Stage 2 (AI 분석) service layer.
//
// The UI only talks to `analyzeDiary()`. Behind it there are two providers:
//  - a Supabase Edge Function when the public Supabase config is set
//  - a deterministic local mock otherwise, so the whole flow can be built
//    and tested before any key exists
// The OpenAI key and model configuration live only in Supabase Secrets.
// ---------------------------------------------------------------------------

export interface DiaryAnalysisInput {
  photoDataUrl: string | null;
  title: string;
  content: string;
  weather: WeatherValue;
}

export interface DiaryAnalysis {
  photoKeywords: string[];
  diaryKeywords: string[];
  emotions: string[];
  /** Verbatim substrings of the diary content, to be circled in the preview. */
  highlightWords: string[];
  /** One verbatim sentence of the diary content, underlined in the preview. */
  highlightSentence: string | null;
  /** The teacher-style one-line comment. */
  comment: string;
}

export type AnalysisErrorCode =
  | "timeout"
  | "network"
  | "invalid-key"
  | "rate-limited"
  | "daily-limit-exceeded"
  | "api-error"
  | "invalid-response";

export const ANALYSIS_ERROR_MESSAGES: Record<AnalysisErrorCode, string> = {
  timeout: "분석이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.",
  network: "네트워크 연결을 확인하고 다시 시도해 주세요.",
  "invalid-key": "AI 연결 설정을 확인해 주세요.",
  "rate-limited": "지금은 요청이 많아요. 잠시 후 다시 시도해 주세요.",
  "daily-limit-exceeded":
    "오늘 사용할 수 있는 횟수를 모두 사용했어요. 내일 다시 이용해 주세요.",
  "api-error": "분석 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  "invalid-response": "분석 결과를 읽지 못했어요. 다시 시도해 주세요.",
};

export class AnalysisError extends Error {
  constructor(public readonly code: AnalysisErrorCode) {
    super(code);
    this.name = "AnalysisError";
  }
}

export function analysisErrorMessage(error: unknown): string {
  if (error instanceof AnalysisError) {
    return ANALYSIS_ERROR_MESSAGES[error.code];
  }
  return ANALYSIS_ERROR_MESSAGES["api-error"];
}

// Analysis remains available in test mode. Only the costly image-generation
// operation is bypassed there.
export const isAiConnected = isSupabaseConfigured;

/**
 * Analyzes the photo + diary text and returns keywords, emotions, highlight
 * targets and the one-line comment (개발 단계 2단계).
 */
export function analyzeDiary(
  input: DiaryAnalysisInput,
): Promise<DiaryAnalysis> {
  return isAiConnected
    ? analyzeWithEdgeFunction(input)
    : analyzeWithMock(input);
}

// --- Supabase Edge Function provider ---------------------------------------

// The spec's 예외 처리 section requires a timeout path; 30s matches its
// "평균 생성 시간 30초 이내" target.
const REQUEST_TIMEOUT_MS = 30_000;

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    )
    .map((item) => item.trim())
    .slice(0, max);
}

// The model is instructed not to repeat or highlight profanity, but its JSON
// is still untrusted. Normalize spacing/symbol obfuscations and enforce that
// rule again before any keyword, tag or correction mark reaches the UI.
function containsProfanity(value: string): boolean {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

  return /(씨발|시발(?!점)|ㅅㅂ|개새끼|개새|병신|ㅂㅅ|좆|존나|ㅈㄴ|지랄|꺼져|fuck|shit|욕설)/u.test(
    normalized,
  );
}

function capComment(comment: string): string {
  const characters = Array.from(comment);
  if (characters.length <= 50) {
    return comment;
  }
  return `${characters.slice(0, 49).join("").trimEnd()}…`;
}

// The model's JSON is untrusted input: every field is validated, and highlight
// targets that are not verbatim substrings of the diary are dropped so the
// preview never marks text that isn't there.
function parseAnalysis(parsed: unknown, content: string): DiaryAnalysis {
  if (typeof parsed !== "object" || parsed === null) {
    throw new AnalysisError("invalid-response");
  }
  const record = parsed as Record<string, unknown>;

  const comment =
    typeof record.comment === "string" ? record.comment.trim() : "";
  if (comment === "") {
    // The comment is the one field the user actually reads — without it the
    // response is useless, so treat it as a failure (spec: 한줄평 생성 실패).
    throw new AnalysisError("invalid-response");
  }

  // Verbatim-filter BEFORE capping at 4: if the model pads the list with
  // paraphrased words, slicing first could throw away the valid ones.
  const highlightWords = toStringArray(record.highlight_words, 8)
    .filter((word) => content.includes(word) && !containsProfanity(word))
    .slice(0, 4);
  const sentence =
    typeof record.highlight_sentence === "string"
      ? record.highlight_sentence.trim()
      : "";
  // Length cap: underlining a huge "sentence" would decorate most of the
  // diary, against the spec's 첨삭 원칙 (지나치게 많이 사용하지 않음).
  const sentenceIsUsable =
    sentence !== "" &&
    sentence.length <= 100 &&
    content.includes(sentence) &&
    !containsProfanity(sentence);

  return {
    photoKeywords: toStringArray(record.photo_keywords, 3),
    diaryKeywords: toStringArray(record.diary_keywords, 4).filter(
      (keyword) => !containsProfanity(keyword),
    ),
    emotions: toStringArray(record.emotions, 3),
    highlightWords,
    highlightSentence: sentenceIsUsable ? sentence : null,
    comment: capComment(comment),
  };
}

async function analyzeWithEdgeFunction(
  input: DiaryAnalysisInput,
): Promise<DiaryAnalysis> {
  try {
    const body = await invokeDiaryAi(
      {
        action: "analyze",
        input: {
          photoDataUrl: input.photoDataUrl,
          title: input.title,
          content: input.content,
          weather: weatherLabel(input.weather),
        },
      },
      REQUEST_TIMEOUT_MS,
    );
    return parseAnalysis(body, input.content);
  } catch (error) {
    if (error instanceof AnalysisError) {
      throw error;
    }
    if (error instanceof EdgeFunctionError) {
      if (error.kind === "timeout") {
        throw new AnalysisError("timeout");
      }
      if (error.kind === "network") {
        throw new AnalysisError("network");
      }
      if (error.kind === "invalid-response") {
        throw new AnalysisError("invalid-response");
      }
      if (
        error.status === 401 ||
        error.status === 403 ||
        error.code === "invalid-key"
      ) {
        throw new AnalysisError("invalid-key");
      }
      if (error.code === "daily-limit-exceeded") {
        throw new AnalysisError("daily-limit-exceeded");
      }
      if (error.status === 429 || error.code === "rate-limited") {
        throw new AnalysisError("rate-limited");
      }
    }
    throw new AnalysisError("api-error");
  }
}

// --- Mock provider ----------------------------------------------------------
// Deterministic on purpose: the same diary always produces the same result,
// which makes the preview UI stable to build against and easy to eyeball.

const MOCK_DELAY_MS = 1200;

// The three example comments from the planning doc, so the mock output looks
// like what the real model is asked to produce.
const MOCK_COMMENTS = [
  "시원한 바다와 함께한 여유로운 하루가 글에 잘 담겨 있네요.",
  "친구들과 보낸 즐거운 여름의 순간이 오래 기억에 남을 것 같아요.",
  "파도 소리와 편안했던 마음이 함께 전해지는 기록이에요.",
];

const MOCK_EMOTION_RULES: Array<{ pattern: RegExp; emotion: string }> = [
  { pattern: /즐거|즐겁|재밌|재미|신나/, emotion: "즐거움" },
  { pattern: /편안|여유|힐링/, emotion: "편안함" },
  { pattern: /행복|좋았|좋아/, emotion: "행복" },
  { pattern: /시원|바다|계곡|수영/, emotion: "시원함" },
  { pattern: /설레|기대/, emotion: "설렘" },
];

// Naive tokenizer: split on whitespace, strip edge punctuation, keep 2-8 char
// words. Longest-first is arbitrary but deterministic — good enough for a
// stand-in until the real model picks meaningful words.
function extractCandidateWords(content: string): string[] {
  const seen = new Set<string>();
  for (const token of content.split(/\s+/)) {
    const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (word.length >= 2 && word.length <= 8) {
      seen.add(word);
    }
  }
  return [...seen].sort((a, b) => b.length - a.length);
}

// Pieces produced by split() are contiguous substrings of the content, and
// trimming only removes edge whitespace — so the pick stays verbatim, which
// the highlight renderer requires.
function pickHighlightSentence(content: string): string | null {
  const pieces = content
    .split(/[.!?…\n]+/)
    .map((piece) => piece.trim())
    // 10-80 chars: long enough to be a sentence, short enough that the
    // underline stays an accent instead of covering the whole diary.
    .filter((piece) => piece.length >= 10 && piece.length <= 80);
  if (pieces.length === 0) {
    return null;
  }
  return pieces.reduce((longest, piece) =>
    piece.length > longest.length ? piece : longest,
  );
}

async function analyzeWithMock(
  input: DiaryAnalysisInput,
): Promise<DiaryAnalysis> {
  // Simulated latency so the loading UI is actually exercised in dev.
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  const words = extractCandidateWords(input.content);
  const emotions = MOCK_EMOTION_RULES.filter((rule) =>
    rule.pattern.test(input.content),
  )
    .map((rule) => rule.emotion)
    .slice(0, 3);

  return {
    // No client-side vision here — fixed summer-themed placeholders.
    photoKeywords: ["여름", "추억"],
    diaryKeywords: words.slice(0, 4),
    emotions: emotions.length > 0 ? emotions : ["행복", "여유"],
    highlightWords: words.slice(0, 3),
    highlightSentence: pickHighlightSentence(input.content),
    comment: MOCK_COMMENTS[input.content.length % MOCK_COMMENTS.length],
  };
}
