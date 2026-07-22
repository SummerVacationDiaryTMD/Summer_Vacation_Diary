// DEBUG-ONLY variant of ./index.ts for diagnosing local-LLM (Ollama proxy)
// failures. Not meant to stay deployed — revert to index.ts before release.
//
// Differences from the production entrypoint:
//   1. "analyze" calls ONLY the local LLM. There is NO OpenAI fallback: any
//      failure surfaces as an error instead of being silently papered over.
//   2. Every failure returns a verbose { code, debug } JSON payload — which
//      stage failed, the request summary, the upstream status/headers/body,
//      timing, and the raw exception — so curl output alone tells the story.
//   3. Extra action "debug-ping" probes the proxy's /healthz and /v1/models
//      to separate tunnel/auth problems from chat-completion problems.
//   4. "analyze" SKIPS rate limiting: it no longer triggers paid calls, and
//      the 5-per-10-min device quota would block a debugging loop while also
//      draining the shared daily quota used by the real app.
//   5. "sketch" is unchanged (still OpenAI, still rate limited).
//
// This file is self-contained on purpose: importing from ./index.ts would
// execute its top-level Deno.serve() and register the production handler,
// so shared helpers are duplicated here instead. The one deliberate
// exception is the ./prompts/ content modules — they are side-effect free,
// and importing the same files as production means debug runs always
// exercise the exact prompts users get.

import { createClient } from "npm:@supabase/supabase-js@2";
import { ANALYSIS_PROMPT } from "./prompts/analysis.ts";
import { SKETCH_PROMPT } from "./prompts/sketch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-diary-client-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

// Only "sketch" consumes quota in this debug build — see header comment.
const USAGE_LIMITS = {
  shortWindowSeconds: 10 * 60,
  userShort: 5,
  ipShort: 10,
  userDaily: 20,
  ipDaily: 60,
} as const;

const DEFAULT_LOCAL_MODEL = "gemma4:12b-64k";

// Longer than production's 60s: the first call after ~5 idle minutes must
// load the 12B model back into memory (Ollama keep_alive), which alone can
// take tens of seconds on top of vision encoding + generation. Override with
// the LOCAL_LLM_TIMEOUT_MS secret when experimenting.
const LOCAL_LLM_TIMEOUT_MS =
  Number(Deno.env.get("LOCAL_LLM_TIMEOUT_MS")) || 90_000;

// Upstream bodies are truncated in debug payloads so an accidental huge
// response cannot blow up logs or the HTTP response.
const MAX_DEBUG_BODY_CHARS = 4000;

class FunctionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 500,
  ) {
    super(code);
  }
}

interface UpstreamResponseDebug {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyTruncated: boolean;
}

interface DebugInfo {
  // Which step failed. Stages appear in execution order:
  // env-check → fetch → read-body → http-status → parse-body →
  // extract-content → parse-model-content.
  stage: string;
  // Human-readable first guess at the cause, based on the failure shape.
  hint?: string;
  request?: Record<string, unknown>;
  response?: UpstreamResponseDebug;
  // The model's message.content when it existed but was not valid JSON.
  modelContent?: string;
  exception?: { name: string; message: string; stack?: string };
  env?: Record<string, string>;
}

// Same contract as FunctionError, but carries the debug payload so the
// top-level catch can return it to the caller instead of a bare code.
class DebugError extends FunctionError {
  constructor(
    code: string,
    status: number,
    readonly debug: DebugInfo,
  ) {
    super(code, status);
  }
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FunctionError(`invalid-${name}`, 400);
  }
  return value;
}

function truncateBody(text: string): {
  bodyText: string;
  bodyTruncated: boolean;
} {
  if (text.length <= MAX_DEBUG_BODY_CHARS) {
    return { bodyText: text, bodyTruncated: false };
  }
  return { bodyText: text.slice(0, MAX_DEBUG_BODY_CHARS), bodyTruncated: true };
}

function exceptionInfo(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "unknown", message: String(error) };
}

// Reports presence/length only — secret VALUES must never reach logs or
// responses. The base URL itself is included because misconfigured URLs are
// a top failure cause and the hostname is already public via the tunnel.
function envSummary(): Record<string, string> {
  const describeSecret = (name: string): string => {
    const value = Deno.env.get(name);
    return value ? `set (${value.length} chars)` : "NOT SET";
  };
  return {
    LOCAL_LLM_BASE_URL: Deno.env.get("LOCAL_LLM_BASE_URL") ?? "NOT SET",
    LOCAL_LLM_API_KEY: describeSecret("LOCAL_LLM_API_KEY"),
    LOCAL_LLM_MODEL:
      Deno.env.get("LOCAL_LLM_MODEL") ||
      `NOT SET (default: ${DEFAULT_LOCAL_MODEL})`,
    LOCAL_LLM_TIMEOUT_MS: String(LOCAL_LLM_TIMEOUT_MS),
    OPENAI_API_KEY: describeSecret("OPENAI_API_KEY"),
  };
}

function localBaseUrl(): string {
  const raw = Deno.env.get("LOCAL_LLM_BASE_URL")?.replace(/\/+$/, "");
  if (!raw) {
    throw new DebugError("missing-local-llm-url", 500, {
      stage: "env-check",
      hint: "LOCAL_LLM_BASE_URL secret is not set — this debug build never falls back to OpenAI.",
      env: envSummary(),
    });
  }
  return raw;
}

// Maps upstream HTTP statuses to the most likely cause in THIS deployment
// (FastAPI auth proxy behind a Cloudflare Tunnel in front of Ollama), so the
// debug payload points at the right machine to inspect first.
function hintForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "Auth rejected by the proxy — check LOCAL_LLM_API_KEY matches a key registered in the proxy's DB.";
  }
  if (status === 404) {
    return "Route not found — LOCAL_LLM_BASE_URL may include an extra path, or the proxy does not route /v1/chat/completions.";
  }
  if (status === 422) {
    return "FastAPI request validation failed — read response.bodyText 'detail'. Likely the multimodal content array (text + image_url parts) does not match the proxy's message schema.";
  }
  if (status === 429) {
    return "Proxy or Ollama throttled the request.";
  }
  if (status === 502 || status === 503 || status === 504) {
    return "Proxy reachable but its upstream failed — check `ollama serve` and the proxy logs on the Mac mini.";
  }
  if (status === 520 || status === 521 || status === 530) {
    return "Cloudflare Tunnel error — cloudflared on the Mac mini is likely down or cannot reach 127.0.0.1:8000.";
  }
  return "Unexpected status — inspect response.bodyText and the proxy logs.";
}

// Shared upstream call wrapper: times the round-trip, always reads the body
// as TEXT first (so Cloudflare/FastAPI HTML or plaintext error pages are
// captured verbatim), and converts transport failures into DebugErrors.
async function debugFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  requestSummary: Record<string, unknown>,
): Promise<{
  response: Response;
  bodyText: string;
  upstream: UpstreamResponseDebug;
}> {
  console.log(
    `[debug] -> ${init.method ?? "GET"} ${url} ${JSON.stringify(requestSummary)}`,
  );
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const exception = exceptionInfo(error);
    // AbortSignal.timeout aborts with a DOMException named "TimeoutError";
    // anything else (DNS, TLS, refused connection) surfaces as a TypeError.
    const timedOut = exception.name === "TimeoutError";
    console.error(
      `[debug] xx fetch failed after ${durationMs}ms: ${exception.name}: ${exception.message}`,
    );
    throw new DebugError(
      timedOut ? "local-llm-timeout" : "local-llm-unreachable",
      502,
      {
        stage: "fetch",
        hint: timedOut
          ? `No response within ${timeoutMs}ms (waited ${durationMs}ms). A cold model load after idle can take tens of seconds — retry once while the model is warm, or raise LOCAL_LLM_TIMEOUT_MS.`
          : "fetch() failed before any HTTP response — DNS, TLS, or connection-level problem. Is the tunnel hostname correct and resolvable?",
        request: requestSummary,
        exception,
        env: envSummary(),
      },
    );
  }

  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new DebugError("local-llm-body-unreadable", 502, {
      stage: "read-body",
      hint: "Got HTTP status/headers but the body stream failed mid-read — likely the tunnel or proxy dropped the connection during generation.",
      request: requestSummary,
      exception: exceptionInfo(error),
      env: envSummary(),
    });
  }
  const durationMs = Date.now() - startedAt;

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const upstream: UpstreamResponseDebug = {
    status: response.status,
    statusText: response.statusText,
    durationMs,
    headers,
    ...truncateBody(bodyText),
  };
  console.log(
    `[debug] <- ${response.status} in ${durationMs}ms, body ${bodyText.length} chars: ${bodyText.slice(0, 500)}`,
  );
  return { response, bodyText, upstream };
}

// Connectivity probe, callable without the app: POST {"action":"debug-ping"}.
// Checks the two cheapest proxy endpoints so tunnel-down, auth-broken, and
// model-missing can each be ruled out before debugging chat completions.
async function debugPing(): Promise<unknown> {
  const env = envSummary();
  let baseUrl: string;
  try {
    baseUrl = localBaseUrl();
  } catch (error) {
    return {
      ok: false,
      env,
      error: error instanceof DebugError ? error.debug : exceptionInfo(error),
    };
  }

  const model = Deno.env.get("LOCAL_LLM_MODEL") || DEFAULT_LOCAL_MODEL;
  const results: Record<string, unknown> = { env, model };

  // /healthz is unauthenticated liveness; /v1/models exercises the API key.
  try {
    const { upstream } = await debugFetch(
      `${baseUrl}/healthz`,
      { method: "GET" },
      15_000,
      { check: "healthz" },
    );
    results.healthz = upstream;
  } catch (error) {
    results.healthz =
      error instanceof DebugError ? error.debug : exceptionInfo(error);
  }

  try {
    const { response, bodyText, upstream } = await debugFetch(
      `${baseUrl}/v1/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${Deno.env.get("LOCAL_LLM_API_KEY") ?? ""}`,
        },
      },
      15_000,
      { check: "models" },
    );
    results.models = upstream;
    if (response.ok) {
      try {
        const parsed = JSON.parse(bodyText) as {
          data?: Array<{ id?: unknown }>;
        };
        results.modelListed = Array.isArray(parsed.data)
          ? parsed.data.some((entry) => entry.id === model)
          : "response has no data[] array";
      } catch {
        results.modelListed = "models response is not JSON";
      }
    } else {
      results.modelListed = "models request failed";
    }
  } catch (error) {
    results.models =
      error instanceof DebugError ? error.debug : exceptionInfo(error);
    results.modelListed = "models request failed";
  }

  return results;
}

async function analyzeWithLocalLlm(input: unknown): Promise<unknown> {
  if (typeof input !== "object" || input === null) {
    throw new FunctionError("invalid-input", 400);
  }
  const record = input as Record<string, unknown>;
  const title = requireString(record.title, "title");
  const content = requireString(record.content, "content");
  const weather = requireString(record.weather, "weather");

  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `제목: ${title}\n날씨: ${weather}\n일기:\n${content}`,
    },
  ];
  const photoChars =
    typeof record.photoDataUrl === "string" ? record.photoDataUrl.length : 0;
  if (typeof record.photoDataUrl === "string") {
    userContent.push({
      type: "image_url",
      image_url: { url: record.photoDataUrl, detail: "low" },
    });
  }

  const baseUrl = localBaseUrl();
  const url = `${baseUrl}/v1/chat/completions`;
  const model = Deno.env.get("LOCAL_LLM_MODEL") || DEFAULT_LOCAL_MODEL;

  // Sizes only, never the diary text itself — debug logs are stored in the
  // Supabase dashboard and should not accumulate user content.
  const requestSummary: Record<string, unknown> = {
    url,
    model,
    maxTokensField: "max_tokens",
    responseFormat: "json_object",
    reasoningEffort: "none",
    titleChars: title.length,
    contentChars: content.length,
    hasPhoto: photoChars > 0,
    photoDataUrlChars: photoChars,
    apiKey: Deno.env.get("LOCAL_LLM_API_KEY") ? "present" : "MISSING",
  };

  const { response, bodyText, upstream } = await debugFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("LOCAL_LLM_API_KEY") ?? ""}`,
      },
      body: JSON.stringify({
        model,
        // Ollama's OpenAI-compatible layer understands max_tokens, not
        // OpenAI's newer max_completion_tokens.
        max_tokens: 1200,
        // gemma4 is a thinking model: without this it spends most of its
        // token/time budget on a reasoning trace (~85s observed) before the
        // JSON answer. "none" disables thinking on Ollama's /v1 endpoint;
        // the native `think: false` parameter does NOT work there.
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ANALYSIS_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    },
    LOCAL_LLM_TIMEOUT_MS,
    requestSummary,
  );

  if (!response.ok) {
    throw new DebugError("local-llm-http-error", 502, {
      stage: "http-status",
      hint: hintForStatus(response.status),
      request: requestSummary,
      response: upstream,
      env: envSummary(),
    });
  }

  let parsedBody: {
    choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>;
    usage?: unknown;
  };
  try {
    parsedBody = JSON.parse(bodyText);
  } catch (error) {
    throw new DebugError("local-llm-invalid-json", 502, {
      stage: "parse-body",
      hint: "2xx status but the body is not JSON — something between us and Ollama rewrote the response (streaming enabled? HTML error page with 200?).",
      request: requestSummary,
      response: upstream,
      exception: exceptionInfo(error),
    });
  }

  // If "reasoning" is still populated, reasoning_effort:"none" was dropped
  // somewhere on the way to Ollama (proxy schema stripping extra fields?).
  const message = parsedBody?.choices?.[0]?.message;
  const reasoning = message?.reasoning;
  console.log(
    `[debug] usage: ${JSON.stringify(parsedBody?.usage)}, reasoning: ${
      typeof reasoning === "string" && reasoning.length > 0
        ? `PRESENT (${reasoning.length} chars — thinking still active!)`
        : "absent (thinking off)"
    }`,
  );

  const raw = message?.content;
  if (typeof raw !== "string") {
    throw new DebugError("local-llm-no-content", 502, {
      stage: "extract-content",
      hint: "Body parsed as JSON but has no choices[0].message.content string — is the proxy returning a proper OpenAI-style chat completion object?",
      request: requestSummary,
      response: upstream,
    });
  }

  try {
    const result = JSON.parse(raw);
    console.log(
      `[debug] ok analyze succeeded — model content parsed as JSON (${raw.length} chars)`,
    );
    return result;
  } catch {
    // Deliberately NOT salvaging fenced JSON here: the point of the debug
    // build is to see the failure mode, not to mask it.
    const fenced = raw.includes("```");
    throw new DebugError("local-llm-content-not-json", 502, {
      stage: "parse-model-content",
      hint: fenced
        ? "message.content wraps JSON in markdown ``` fences — response_format json_object is being ignored (proxy not forwarding it, or the Ollama/model combo does not honor it)."
        : "message.content is not valid JSON — the model answered free-form; response_format json_object is likely unsupported on this route.",
      request: requestSummary,
      modelContent: truncateBody(raw).bodyText,
      response: upstream,
    });
  }
}

// ---------------------------------------------------------------------------
// Everything below is copied unchanged from index.ts for the sketch path.
// ---------------------------------------------------------------------------

function getSupabaseSecret(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as { default?: unknown };
      if (typeof parsed.default === "string" && parsed.default !== "") {
        return parsed.default;
      }
    } catch {
      throw new FunctionError("invalid-supabase-secret", 500);
    }
  }

  const legacySecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacySecret) {
    throw new FunctionError("missing-supabase-secret", 500);
  }
  return legacySecret;
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return (
    forwarded?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function enforceUsageLimit(request: Request): Promise<void> {
  const clientId = requireString(
    request.headers.get("x-diary-client-id"),
    "client-id",
  );
  const salt = Deno.env.get("RATE_LIMIT_SALT");
  if (!salt) {
    throw new FunctionError("missing-rate-limit-salt", 500);
  }

  const ip = clientIp(request) ?? `unavailable:${clientId}`;
  const [userHash, ipHash] = await Promise.all([
    sha256(`user:${salt}:${clientId}`),
    sha256(`ip:${salt}:${ip}`),
  ]);

  const now = Date.now();
  const shortMs = USAGE_LIMITS.shortWindowSeconds * 1000;
  const shortWindowStart = new Date(Math.floor(now / shortMs) * shortMs);
  const dayWindowStart = new Date();
  dayWindowStart.setUTCHours(0, 0, 0, 0);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new FunctionError("missing-supabase-url", 500);
  }
  const admin = createClient(supabaseUrl, getSupabaseSecret(), {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc("consume_diary_ai_quota", {
    p_user_hash: userHash,
    p_ip_hash: ipHash,
    p_short_window_start: shortWindowStart.toISOString(),
    p_day_window_start: dayWindowStart.toISOString(),
    p_user_short_limit: USAGE_LIMITS.userShort,
    p_ip_short_limit: USAGE_LIMITS.ipShort,
    p_user_daily_limit: USAGE_LIMITS.userDaily,
    p_ip_daily_limit: USAGE_LIMITS.ipDaily,
  });

  if (error || typeof data !== "string") {
    console.error("Rate limit RPC failed", error?.message ?? "invalid result");
    throw new FunctionError("rate-limit-unavailable", 503);
  }
  if (data.endsWith("-short")) {
    throw new FunctionError("rate-limited", 429);
  }
  if (data.endsWith("-daily")) {
    throw new FunctionError("daily-limit-exceeded", 429);
  }
  if (data !== "allowed") {
    throw new FunctionError("rate-limit-unavailable", 503);
  }
}

async function openAiError(response: Response): Promise<FunctionError> {
  let code = "";
  let message = "";
  try {
    const body = await response.json();
    code = typeof body?.error?.code === "string" ? body.error.code : "";
    message =
      typeof body?.error?.message === "string" ? body.error.message : "";
  } catch {
    // Use the HTTP status mapping below when OpenAI returns a non-JSON body.
  }

  if (response.status === 401) return new FunctionError("invalid-key", 502);
  if (code === "insufficient_quota") {
    return new FunctionError("quota-exceeded", 429);
  }
  if (response.status === 429) return new FunctionError("rate-limited", 429);
  if (code === "moderation_blocked" || message.includes("safety system")) {
    return new FunctionError("content-blocked", 400);
  }
  if (
    response.status === 403 ||
    code === "model_not_found" ||
    message.toLowerCase().includes("verif")
  ) {
    return new FunctionError("model-unavailable", 502);
  }
  return new FunctionError("api-error", 502);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const match = /^data:([^;]+);base64$/.exec(dataUrl.slice(0, comma));
  if (comma === -1 || !match) {
    throw new FunctionError("invalid-image", 400);
  }

  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

async function sketch(photoDataUrl: unknown, apiKey: string): Promise<unknown> {
  const photo = requireString(photoDataUrl, "image");
  const quality = Deno.env.get("OPENAI_IMAGE_QUALITY") || "medium";
  if (!["low", "medium", "high"].includes(quality)) {
    throw new FunctionError("invalid-image-quality", 500);
  }

  const form = new FormData();
  form.append("model", Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-1");
  form.append("image", dataUrlToBlob(photo), "photo.jpg");
  form.append("prompt", SKETCH_PROMPT);
  form.append("size", "auto");
  form.append("quality", quality);
  form.append("output_format", "jpeg");
  form.append("n", "1");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) throw await openAiError(response);
  const body = await response.json();
  const imageBase64 = body?.data?.[0]?.b64_json;
  if (typeof imageBase64 !== "string" || imageBase64 === "") {
    throw new FunctionError("invalid-response", 502);
  }
  return { imageBase64 };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return responseJson({ code: "method-not-allowed" }, 405);
  }

  console.log(
    `[debug] incoming request — client-id: ${
      request.headers.get("x-diary-client-id") ? "present" : "(none)"
    }, content-length: ${request.headers.get("content-length") ?? "?"}`,
  );

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch (error) {
      throw new DebugError("invalid-json-body", 400, {
        stage: "parse-request",
        exception: exceptionInfo(error),
      });
    }
    const action = body?.action;

    if (action === "debug-ping") {
      return responseJson(await debugPing());
    }

    if (action === "analyze") {
      // Debug build: no OPENAI_API_KEY requirement and no rate limiting on
      // this path — see the header comment for the reasoning.
      console.log("[debug] analyze — rate limiting SKIPPED (debug build)");
      return responseJson(await analyzeWithLocalLlm(body.input));
    }

    if (action === "sketch") {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) throw new FunctionError("invalid-key", 500);
      await enforceUsageLimit(request);
      return responseJson(await sketch(body.photoDataUrl, apiKey));
    }

    throw new DebugError("invalid-action", 400, {
      stage: "route",
      hint: `Received action=${JSON.stringify(action)}; expected "analyze", "sketch", or "debug-ping".`,
    });
  } catch (error) {
    if (error instanceof DebugError) {
      console.error(`[debug] xx ${error.code} at stage "${error.debug.stage}"`);
      return responseJson({ code: error.code, debug: error.debug }, error.status);
    }
    if (error instanceof FunctionError) {
      return responseJson({ code: error.code }, error.status);
    }
    console.error(
      "[debug] unhandled:",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return responseJson(
      { code: "api-error", debug: { stage: "unhandled", exception: exceptionInfo(error) } },
      500,
    );
  }
});
