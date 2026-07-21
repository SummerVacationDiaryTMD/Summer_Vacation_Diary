import { getDeviceId } from "@apps-in-toss/web-framework";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
).trim();

const DIARY_AI_FUNCTION_URL = `${supabaseUrl}/functions/v1/diary-ai`;
const CLIENT_ID_STORAGE_KEY = "summer-vacation-diary:client-id:v1";
let sessionClientId: string | null = null;

export const isSupabaseConfigured = supabaseUrl !== "" && publishableKey !== "";

export type EdgeFunctionErrorKind =
  "timeout" | "network" | "http" | "invalid-response";

export class EdgeFunctionError extends Error {
  constructor(
    public readonly kind: EdgeFunctionErrorKind,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(code ?? kind);
    this.name = "EdgeFunctionError";
  }
}

interface EdgeErrorBody {
  code?: unknown;
}

function createClientId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Uses Toss's installation/device identifier when available. Plain-browser
 * development gets a random, persisted installation ID instead. This is only
 * a rate-limit hint: the server hashes it with a secret salt before storage.
 */
function getRateLimitClientId(): string {
  try {
    const tossDeviceId = getDeviceId();
    if (tossDeviceId.trim() !== "") {
      return `toss:${tossDeviceId}`;
    }
  } catch {
    // Expected in a normal browser outside the Toss bridge.
  }

  try {
    const stored = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (stored !== null && stored !== "") {
      return `web:${stored}`;
    }
    const created = createClientId();
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return `web:${created}`;
  } catch {
    // Private browsing can deny localStorage; keep a stable ID for this tab.
    sessionClientId ??= createClientId();
    return `session:${sessionClientId}`;
  }
}

/** Calls the shared `diary-ai` Supabase Edge Function. */
export async function invokeDiaryAi(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  if (!isSupabaseConfigured) {
    throw new EdgeFunctionError("network");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let phase: "request" | "body" = "request";

  try {
    const response = await fetch(DIARY_AI_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // New sb_publishable_* keys belong in apikey, not Authorization.
        apikey: publishableKey,
        "x-diary-client-id": getRateLimitClientId(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    phase = "body";
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new EdgeFunctionError("invalid-response", response.status);
    }

    if (!response.ok) {
      const errorBody = responseBody as EdgeErrorBody;
      throw new EdgeFunctionError(
        "http",
        response.status,
        typeof errorBody.code === "string" ? errorBody.code : undefined,
      );
    }

    return responseBody;
  } catch (error) {
    if (error instanceof EdgeFunctionError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new EdgeFunctionError("timeout");
    }
    throw new EdgeFunctionError(
      phase === "request" ? "network" : "invalid-response",
    );
  } finally {
    clearTimeout(timer);
  }
}
