const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
).trim();

const DIARY_AI_FUNCTION_URL = `${supabaseUrl}/functions/v1/diary-ai`;

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
