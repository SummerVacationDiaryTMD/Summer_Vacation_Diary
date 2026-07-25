import { recompressDataUrl } from "../utils/image";
import { applyPencilFilter } from "../utils/sketchFilter";
import {
  EdgeFunctionError,
  invokeDiaryAi,
  isAiTestMode,
  isSupabaseConfigured,
} from "./supabaseEdge";

export type SketchErrorCode =
  | "timeout"
  | "network"
  | "invalid-key"
  | "invalid-image"
  | "model-unavailable"
  | "rate-limited"
  | "sketch-daily-limit-exceeded"
  | "ip-burst-limit-exceeded"
  | "ip-daily-limit-exceeded"
  | "service-daily-limit-exceeded"
  // Legacy: the server stopped sending this when limits went per-action. Kept
  // so rolling the Edge Function back cannot produce a blank message.
  | "daily-limit-exceeded"
  | "quota-exceeded"
  | "content-blocked"
  | "api-error"
  | "invalid-response";

/**
 * The preview shows one short line, "{cause} 그림을 못그렸어요.", so these are
 * sentence fragments rather than full messages. Naming the cause matters: it is
 * what tells a child whether picking a different photo would help or whether
 * there is simply nothing to do right now.
 */
export const SKETCH_ERROR_CAUSES: Record<SketchErrorCode, string> = {
  "content-blocked": "부적절한 이미지때문에",
  "invalid-image": "깨진 이미지때문에",
  "sketch-daily-limit-exceeded": "오늘 그림 그리기 횟수를 다 써서",
  "ip-daily-limit-exceeded": "오늘 그림 그리기 횟수를 다 써서",
  "service-daily-limit-exceeded": "오늘 그림 그리기 횟수를 다 써서",
  "daily-limit-exceeded": "오늘 그림 그리기 횟수를 다 써서",
  // Everything transient reads the same way on purpose — the distinction
  // between a timeout, a busy model and a dead tunnel is ours to debug from the
  // logs, not the child's to interpret.
  timeout: "친구가 쉬러가서",
  network: "친구가 쉬러가서",
  "api-error": "친구가 쉬러가서",
  "model-unavailable": "친구가 쉬러가서",
  "rate-limited": "친구가 쉬러가서",
  "ip-burst-limit-exceeded": "친구가 쉬러가서",
  "quota-exceeded": "친구가 쉬러가서",
  "invalid-key": "친구가 쉬러가서",
  "invalid-response": "알 수 없는 이유로",
};

// Retrying these cannot succeed: the budget is gone until the daily reset, the
// photo will be rejected again, or our own billing is the problem.
const NON_RETRYABLE_SKETCH_CODES: readonly SketchErrorCode[] = [
  "content-blocked",
  "invalid-image",
  "sketch-daily-limit-exceeded",
  "ip-daily-limit-exceeded",
  "service-daily-limit-exceeded",
  "daily-limit-exceeded",
  "quota-exceeded",
];

export class SketchError extends Error {
  constructor(public readonly code: SketchErrorCode) {
    super(code);
    this.name = "SketchError";
  }
}

/** Builds the preview line for a code, including causes never thrown as an
 *  error — the quota gate blocks before a request is even attempted. */
export function sketchCauseMessage(code: SketchErrorCode): string {
  return `${SKETCH_ERROR_CAUSES[code]} 그림을 못그렸어요.`;
}

export function sketchErrorMessage(error: unknown): string {
  return sketchCauseMessage(sketchErrorCode(error));
}

export function sketchErrorCode(error: unknown): SketchErrorCode {
  return error instanceof SketchError ? error.code : "api-error";
}

export function isSketchErrorRetryable(error: unknown): boolean {
  return !NON_RETRYABLE_SKETCH_CODES.includes(sketchErrorCode(error));
}

export const isSketchAiConnected = isSupabaseConfigured && !isAiTestMode;

/** Converts a photo through Supabase, or uses the local filter in mock mode. */
export function transferPhotoToSketch(photoDataUrl: string): Promise<string> {
  // Test mode deliberately uses the original photo unchanged. It avoids both
  // the paid image model and the local pencil filter while analysis continues.
  if (isAiTestMode) {
    return Promise.resolve(photoDataUrl);
  }
  return isSketchAiConnected
    ? sketchWithEdgeFunction(photoDataUrl)
    : sketchWithLocalFilter(photoDataUrl);
}

const REQUEST_TIMEOUT_MS = 120_000;

function isSketchErrorCode(
  value: string | undefined,
): value is SketchErrorCode {
  // An own-property check rather than `in`: `in` walks the prototype chain, so
  // a server code of "toString" would resolve to a function where a message
  // belongs and crash the render. hasOwnProperty.call instead of Object.hasOwn
  // because the latter is ES2022 and the target here is ES2020.
  return (
    value !== undefined &&
    Object.prototype.hasOwnProperty.call(SKETCH_ERROR_CAUSES, value)
  );
}

async function sketchWithEdgeFunction(photoDataUrl: string): Promise<string> {
  try {
    const body = await invokeDiaryAi(
      { action: "sketch", photoDataUrl },
      REQUEST_TIMEOUT_MS,
    );
    const imageBase64 = (body as { imageBase64?: unknown }).imageBase64;
    if (typeof imageBase64 !== "string" || imageBase64 === "") {
      throw new SketchError("invalid-response");
    }

    try {
      return await recompressDataUrl(`data:image/jpeg;base64,${imageBase64}`);
    } catch {
      throw new SketchError("invalid-response");
    }
  } catch (error) {
    if (error instanceof SketchError) {
      throw error;
    }
    if (error instanceof EdgeFunctionError) {
      if (error.kind === "timeout") {
        throw new SketchError("timeout");
      }
      if (error.kind === "network") {
        throw new SketchError("network");
      }
      if (error.kind === "invalid-response") {
        throw new SketchError("invalid-response");
      }
      if (isSketchErrorCode(error.code)) {
        throw new SketchError(error.code);
      }
      if (error.status === 401 || error.status === 403) {
        throw new SketchError("invalid-key");
      }
      if (error.status === 429) {
        throw new SketchError("rate-limited");
      }
    }
    throw new SketchError("api-error");
  }
}

const MOCK_DELAY_MS = 1500;

async function sketchWithLocalFilter(photoDataUrl: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  try {
    return await applyPencilFilter(photoDataUrl);
  } catch {
    throw new SketchError("invalid-response");
  }
}
