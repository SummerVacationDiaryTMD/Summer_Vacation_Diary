import { recompressDataUrl } from "../utils/image";
import { applyPencilFilter } from "../utils/sketchFilter";
import {
  EdgeFunctionError,
  invokeDiaryAi,
  isSupabaseConfigured,
} from "./supabaseEdge";

export type SketchErrorCode =
  | "timeout"
  | "network"
  | "invalid-key"
  | "model-unavailable"
  | "rate-limited"
  | "quota-exceeded"
  | "content-blocked"
  | "api-error"
  | "invalid-response";

export const SKETCH_ERROR_MESSAGES: Record<SketchErrorCode, string> = {
  timeout: "그림 변환이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.",
  network: "네트워크 연결을 확인하고 다시 시도해 주세요.",
  "invalid-key": "AI 연결 설정을 확인해 주세요.",
  "model-unavailable":
    "이 API 키로는 그림 변환 모델을 쓸 수 없어요. OpenAI 조직 인증 여부를 확인해 주세요.",
  "rate-limited": "지금은 요청이 많아요. 잠시 후 다시 시도해 주세요.",
  "quota-exceeded":
    "OpenAI 크레딧이 모두 소진됐어요. 결제 설정을 확인해 주세요.",
  "content-blocked":
    "이 사진은 그림으로 바꾸지 못했어요. 다른 사진으로 시도해 주세요.",
  "api-error":
    "그림 변환 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
  "invalid-response": "변환된 그림을 읽지 못했어요. 다시 시도해 주세요.",
};

export class SketchError extends Error {
  constructor(public readonly code: SketchErrorCode) {
    super(code);
    this.name = "SketchError";
  }
}

export function sketchErrorMessage(error: unknown): string {
  return SKETCH_ERROR_MESSAGES[sketchErrorCode(error)];
}

export function sketchErrorCode(error: unknown): SketchErrorCode {
  return error instanceof SketchError ? error.code : "api-error";
}

export function isSketchErrorRetryable(error: unknown): boolean {
  return sketchErrorCode(error) !== "content-blocked";
}

export const isSketchAiConnected = isSupabaseConfigured;

/** Converts a photo through Supabase, or uses the local filter in mock mode. */
export function transferPhotoToSketch(photoDataUrl: string): Promise<string> {
  return isSketchAiConnected
    ? sketchWithEdgeFunction(photoDataUrl)
    : sketchWithLocalFilter(photoDataUrl);
}

const REQUEST_TIMEOUT_MS = 120_000;

function isSketchErrorCode(
  value: string | undefined,
): value is SketchErrorCode {
  return value !== undefined && value in SKETCH_ERROR_MESSAGES;
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
