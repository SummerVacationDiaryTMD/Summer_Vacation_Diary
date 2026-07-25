import { createClient } from "npm:@supabase/supabase-js@2";
import { ANALYSIS_PROMPT } from "./prompt_analysis.ts";
import { SKETCH_PROMPT } from "./prompt_sketch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-diary-client-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

// Change limits here without touching the database function. One sketch or
// analysis call consumes one request from three budgets at once: the device's
// per-action budget, the shared IP budget, and the service-wide cap. Daily
// windows reset at 00:00 UTC, which is 09:00 KST — every user-facing message
// must say "내일 아침 9시부터", never "내일".
const USAGE_LIMITS = {
  // The burst window is IP-only. A device budget cannot stop a scripted caller
  // (x-diary-client-id is just a header on a public endpoint), so the short
  // window is only useful where identity cannot be reset at will.
  ipBurstWindowSeconds: 10 * 60,
  ipBurst: 20,
  ipDaily: 100,
  userDaily: { sketch: 3, analyze: 5 },
  // Cost circuit breaker: the real ceiling on a day's spend. Split per action
  // so a flood of cheap analyses cannot starve the expensive sketch budget.
  serviceDaily: { sketch: 150, analyze: 250 },
} as const;

type QuotaAction = "sketch" | "analyze";

// The mini-app ships to a Korean audience inside the Toss app, so a caller from
// anywhere else is far more likely to be a script than a child writing a diary.
// This does not lower the cost ceiling — USAGE_LIMITS.serviceDaily already does
// that — it keeps that fixed budget pointed at the people it is for.
const ALLOWED_COUNTRIES = new Set(["KR"]);

// Supabase documents no country header for Edge Functions, and its own location
// example resolves the country by sending x-forwarded-for to a third-party
// service. These are the headers a Cloudflare-fronted edge *may* forward, tried
// in order — so this gate may legitimately find nothing and do nothing, which
// the `region.country` field in every response makes visible.
const COUNTRY_HEADERS = ["cf-ipcountry", "x-country", "x-vercel-ip-country"];

// The binding ceiling is not this Function's wall-clock limit but the
// CLIENT's: src/services/diaryAnalysis.ts aborts at 30s, so a failed local
// attempt AND the OpenAI fallback (~3-8s with an image) must both fit inside
// it — otherwise the fallback answer is computed but never delivered. 15s sits
// just above the 10.9s measured warm generation; slower than that is treated
// as "not available right now". Overridable per deployment but hard-capped, so
// a stray secret cannot reintroduce a local attempt that outlives the client.
const LOCAL_LLM_TIMEOUT_MS = Math.min(
  Number(Deno.env.get("LOCAL_LLM_TIMEOUT_MS")) || 15_000,
  20_000,
);

// The proxy answers with this the moment Ollama's generation slot is already
// held by an earlier request. Without such a gate the request would wait in
// Ollama's FIFO queue (OLLAMA_MAX_QUEUE, default 512) and be indistinguishable
// from a slow generation, burning the whole budget before falling back.
const LOCAL_BUSY_CODE = "busy";

class FunctionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 500,
  ) {
    super(code);
  }
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// Verbose diagnostics stay off unless DIARY_AI_DEBUG is set as a Secret.
// Supabase caps a function at 100 log events per 10 seconds and one message at
// 10,000 characters, so normal traffic emits one line per request plus whatever
// failed, and the noisy detail is opt-in.
const DEBUG = ["1", "true", "on"].includes(
  (Deno.env.get("DIARY_AI_DEBUG") ?? "").trim().toLowerCase(),
);

/**
 * Stamps every line with a short per-request id and the elapsed time. Requests
 * overlap heavily here — one sketch runs 30-60 seconds — so without an id the
 * lines from concurrent callers interleave into something unreadable.
 *
 * Nothing logged may carry user content. The diary text and the photo are
 * covered by an explicit consent notice about where they travel, and the raw IP
 * is deliberately hashed before it is ever stored, so putting either in a log
 * would quietly undo both. Log sizes, codes and decisions — never values.
 */
class RequestLog {
  private readonly id = Math.random().toString(36).slice(2, 8);
  private readonly startedAt = Date.now();

  private write(level: "log" | "error", message: string): void {
    console[level](`[${this.id} +${Date.now() - this.startedAt}ms] ${message}`);
  }

  info(message: string): void {
    this.write("log", message);
  }

  error(message: string): void {
    this.write("error", message);
  }

  /** Only emitted when DIARY_AI_DEBUG is set. */
  debug(message: string): void {
    if (DEBUG) {
      this.write("log", message);
    }
  }
}

// Written once per isolate at cold start instead of being exposed as a "ping"
// action: it answers the same "is this deployment actually configured?"
// question without adding an unauthenticated probe to a public endpoint. Only
// presence is ever reported, never a value.
console.log(
  `diary-ai boot — ${[
    "OPENAI_API_KEY",
    "RATE_LIMIT_SALT",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_MODEL",
    "OPENAI_IMAGE_MODEL",
    "OPENAI_IMAGE_QUALITY",
    "LOCAL_LLM_BASE_URL",
    "DIARY_AI_DEBUG",
  ]
    .map((name) => `${name}=${Deno.env.get(name) ? "set" : "missing"}`)
    .join(" ")}`,
);

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FunctionError(`invalid-${name}`, 400);
  }
  return value;
}

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

function requestCountry(request: Request): string | null {
  for (const name of COUNTRY_HEADERS) {
    const value = request.headers.get(name)?.trim().toUpperCase();
    // Cloudflare sends XX when it cannot place the address, and T1 for Tor.
    // Both mean "unknown", which is not the same as "somewhere else".
    if (value && value !== "XX" && value !== "T1") {
      return value;
    }
  }
  return null;
}

/**
 * An unknown country is allowed through deliberately. Failing closed would take
 * the entire app down the moment the signal disappears — and the country is a
 * best-effort signal here, not something the platform promises.
 */
function regionAllowed(country: string | null): boolean {
  return country === null || ALLOWED_COUNTRIES.has(country);
}

function requestRegion(request: Request): QuotaRegion {
  const country = requestCountry(request);
  return { allowed: regionAllowed(country), country };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

interface QuotaCounter {
  used: number;
  limit: number;
  remaining: number;
}

interface QuotaRegion {
  allowed: boolean;
  /** ISO-3166 alpha-2, or null when no header carried one. */
  country: string | null;
}

// What the client is allowed to see: its own two counters, when they reset, and
// one reason string when something shared is blocking. The raw service-wide
// numbers stay server-side — publishing how much headroom is left would help
// somebody time a burst against it. The caller's own country is not a secret
// from the caller, and returning it is how we can tell whether the header the
// region gate depends on exists at all.
interface QuotaSnapshot {
  sketch: QuotaCounter;
  analyze: QuotaCounter;
  resetAt: string;
  blocked: null | "device" | "ip-burst" | "ip-daily" | "service";
  region: QuotaRegion;
}

// Raw counters as the database returns them.
interface QuotaCounts {
  userSketch: number;
  userAnalyze: number;
  ipShort: number;
  ipDay: number;
  serviceSketch: number;
  serviceAnalyze: number;
}

interface Reservation {
  action: QuotaAction;
  userHash: string;
  ipHash: string;
  // Kept from the consume call rather than recomputed when refunding: a request
  // consumed at 23:59 UTC that fails at 00:01 must give its request back to
  // yesterday's row — a harmless no-op, since that budget already reset —
  // instead of handing out a free credit against today's.
  shortWindowStart: string;
  dayWindowStart: string;
  snapshot: QuotaSnapshot;
}

// Carries the snapshot so a rejection can tell the client "0 left" in the same
// response instead of forcing a follow-up quota-status call.
class QuotaError extends FunctionError {
  constructor(
    code: string,
    readonly quota: QuotaSnapshot,
  ) {
    super(code, 429);
  }
}

function windowStarts(): { shortWindowStart: string; dayWindowStart: string } {
  const burstMs = USAGE_LIMITS.ipBurstWindowSeconds * 1000;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return {
    shortWindowStart: new Date(
      Math.floor(Date.now() / burstMs) * burstMs,
    ).toISOString(),
    dayWindowStart: dayStart.toISOString(),
  };
}

function adminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new FunctionError("missing-supabase-url", 500);
  }
  return createClient(supabaseUrl, getSupabaseSecret(), {
    auth: { persistSession: false },
  });
}

async function hashIdentifiers(
  request: Request,
): Promise<{ userHash: string; ipHash: string }> {
  const clientId = requireString(
    request.headers.get("x-diary-client-id"),
    "client-id",
  );
  const salt = Deno.env.get("RATE_LIMIT_SALT");
  if (!salt) {
    throw new FunctionError("missing-rate-limit-salt", 500);
  }

  // Supabase normally supplies x-forwarded-for. If it is absent, keep the
  // request usable without collapsing every visitor into one shared bucket;
  // the device bucket still enforces the per-action limits.
  const ip = clientIp(request) ?? `unavailable:${clientId}`;
  const [userHash, ipHash] = await Promise.all([
    sha256(`user:${salt}:${clientId}`),
    sha256(`ip:${salt}:${ip}`),
  ]);
  return { userHash, ipHash };
}

const COUNT_KEYS = [
  "userSketch",
  "userAnalyze",
  "ipShort",
  "ipDay",
  "serviceSketch",
  "serviceAnalyze",
] as const;

function parseCounts(data: unknown): QuotaCounts | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const counts = {} as QuotaCounts;
  for (const key of COUNT_KEYS) {
    const value = record[key];
    if (typeof value !== "number") {
      return null;
    }
    counts[key] = value;
  }
  return counts;
}

function counter(used: number, limit: number): QuotaCounter {
  return { used, limit, remaining: Math.max(limit - used, 0) };
}

// `decision` comes from consume and is authoritative for that request. A plain
// read has no decision, so the same precedence is re-derived from the counts.
// Per-device exhaustion is deliberately absent here: the per-action `remaining`
// fields already say that, and they say it per action.
function blockedReason(
  counts: QuotaCounts,
  decision?: string,
): QuotaSnapshot["blocked"] {
  if (decision !== undefined && decision !== "allowed") {
    if (decision === "device-daily") return "device";
    if (decision === "ip-short") return "ip-burst";
    if (decision === "ip-daily") return "ip-daily";
    if (decision === "service-daily") return "service";
    return null;
  }
  if (counts.ipShort >= USAGE_LIMITS.ipBurst) return "ip-burst";
  if (counts.ipDay >= USAGE_LIMITS.ipDaily) return "ip-daily";
  if (
    counts.serviceSketch >= USAGE_LIMITS.serviceDaily.sketch &&
    counts.serviceAnalyze >= USAGE_LIMITS.serviceDaily.analyze
  ) {
    return "service";
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function buildSnapshot(
  counts: QuotaCounts,
  dayWindowStart: string,
  region: QuotaRegion,
  decision?: string,
): QuotaSnapshot {
  return {
    sketch: counter(counts.userSketch, USAGE_LIMITS.userDaily.sketch),
    analyze: counter(counts.userAnalyze, USAGE_LIMITS.userDaily.analyze),
    resetAt: new Date(Date.parse(dayWindowStart) + DAY_MS).toISOString(),
    blocked: blockedReason(counts, decision),
    region,
  };
}

function rejectionCode(decision: string, action: QuotaAction): string {
  if (decision === "device-daily") {
    return action === "sketch"
      ? "sketch-daily-limit-exceeded"
      : "analyze-daily-limit-exceeded";
  }
  if (decision === "ip-short") return "ip-burst-limit-exceeded";
  if (decision === "ip-daily") return "ip-daily-limit-exceeded";
  if (decision === "service-daily") return "service-daily-limit-exceeded";
  return "";
}

/**
 * Consumes one request up front, before any paid call. Doing it in this order
 * — rather than charging after a successful response — is what makes the limit
 * hold under concurrency: check-then-call would let every parallel request read
 * the same pre-increment count and pass.
 */
async function reserveQuota(
  request: Request,
  action: QuotaAction,
  log: RequestLog,
): Promise<Reservation> {
  const { userHash, ipHash } = await hashIdentifiers(request);
  const { shortWindowStart, dayWindowStart } = windowStarts();
  const region = requestRegion(request);

  const { data, error } = await adminClient().rpc("consume_diary_ai_quota", {
    p_action: action,
    p_user_hash: userHash,
    p_ip_hash: ipHash,
    p_short_window_start: shortWindowStart,
    p_day_window_start: dayWindowStart,
    p_user_daily_limit: USAGE_LIMITS.userDaily[action],
    p_ip_short_limit: USAGE_LIMITS.ipBurst,
    p_ip_daily_limit: USAGE_LIMITS.ipDaily,
    p_service_daily_limit: USAGE_LIMITS.serviceDaily[action],
  });

  const counts = parseCounts(data);
  const decision = (data as { decision?: unknown } | null)?.decision;
  if (error || counts === null || typeof decision !== "string") {
    log.error(`quota consume failed — ${error?.message ?? "invalid result"}`);
    // Fail closed: a database outage must not turn into unlimited paid calls.
    throw new FunctionError("rate-limit-unavailable", 503);
  }

  // All six counters on one line: when a user reports being blocked, which of
  // the four budgets did it is the first thing worth knowing, and only the
  // device pair ever reaches the client.
  log.debug(
    `quota ${action} ${decision} — device ${counts.userSketch}/${counts.userAnalyze}, ip ${counts.ipShort}/${counts.ipDay}, service ${counts.serviceSketch}/${counts.serviceAnalyze}`,
  );

  if (decision !== "allowed") {
    const code = rejectionCode(decision, action);
    if (code === "") {
      throw new FunctionError("rate-limit-unavailable", 503);
    }
    throw new QuotaError(
      code,
      buildSnapshot(counts, dayWindowStart, region, decision),
    );
  }

  return {
    action,
    userHash,
    ipHash,
    shortWindowStart,
    dayWindowStart,
    snapshot: buildSnapshot(counts, dayWindowStart, region, decision),
  };
}

/**
 * Gives a reserved request back. Never throws: this runs inside the error path,
 * and replacing the original failure with a refund failure would hide what
 * actually went wrong. A lost refund costs one request and heals at the reset.
 */
async function refundQuota(
  reservation: Reservation,
  log: RequestLog,
): Promise<QuotaSnapshot | null> {
  try {
    const { data, error } = await adminClient().rpc("refund_diary_ai_quota", {
      p_action: reservation.action,
      p_user_hash: reservation.userHash,
      p_ip_hash: reservation.ipHash,
      p_short_window_start: reservation.shortWindowStart,
      p_day_window_start: reservation.dayWindowStart,
    });
    const counts = parseCounts(data);
    if (error || counts === null) {
      log.error(`quota refund failed — ${error?.message ?? "invalid result"}`);
      return null;
    }
    // The region came from the same request that made the reservation, so it is
    // carried on the snapshot rather than re-derived from headers we no longer
    // have here.
    return buildSnapshot(
      counts,
      reservation.dayWindowStart,
      reservation.snapshot.region,
    );
  } catch (cause) {
    log.error(
      `quota refund threw — ${cause instanceof Error ? cause.message : cause}`,
    );
    return null;
  }
}

async function readQuota(
  request: Request,
  log: RequestLog,
): Promise<QuotaSnapshot> {
  const { userHash, ipHash } = await hashIdentifiers(request);
  const { shortWindowStart, dayWindowStart } = windowStarts();

  const { data, error } = await adminClient().rpc("read_diary_ai_quota", {
    p_user_hash: userHash,
    p_ip_hash: ipHash,
    p_short_window_start: shortWindowStart,
    p_day_window_start: dayWindowStart,
  });

  const counts = parseCounts(data);
  if (error || counts === null) {
    log.error(`quota read failed — ${error?.message ?? "invalid result"}`);
    throw new FunctionError("rate-limit-unavailable", 503);
  }
  return buildSnapshot(counts, dayWindowStart, requestRegion(request));
}

// Denylist, not an allowlist: anything not explicitly the user's fault gets
// refunded, so a code added later defaults to giving the request back. Charging
// somebody for our own bug is the worse of the two failures. The invariant that
// keeps this honest: HTTP 400 means the user's fault, which means no refund.
const NON_REFUNDABLE = new Set([
  "content-blocked",
  "invalid-image",
  "invalid-input",
  "invalid-title",
  "invalid-content",
  "invalid-weather",
]);

function shouldRefund(error: unknown): boolean {
  return error instanceof FunctionError
    ? !NON_REFUNDABLE.has(error.code)
    : true;
}

// analyze() returns whatever JSON the model produced, so spreading it blindly
// would turn an array or a scalar into {0: ..., 1: ...}. quota goes last so a
// model that happens to emit a "quota" key cannot shadow the real one.
function withQuota(result: unknown, quota: QuotaSnapshot): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return result;
  }
  return { ...(result as Record<string, unknown>), quota };
}

// quota-status spends no money and moves no counters, so it does not need the
// database-backed limiter — this only stops one client from hammering the read
// in a loop. Isolates are ephemeral and there are several, so treat it as a
// speed bump rather than a guarantee.
const STATUS_LIMIT = 30;
const STATUS_WINDOW_MS = 10 * 60 * 1000;
const statusHits = new Map<string, number>();
let statusWindowStart = 0;

function enforceStatusLimit(clientId: string): void {
  const windowStart =
    Math.floor(Date.now() / STATUS_WINDOW_MS) * STATUS_WINDOW_MS;
  if (windowStart !== statusWindowStart) {
    // Clearing on the window roll keeps the map bounded without an O(n) sweep
    // on every new client.
    statusWindowStart = windowStart;
    statusHits.clear();
  }
  const count = (statusHits.get(clientId) ?? 0) + 1;
  statusHits.set(clientId, count);
  if (count > STATUS_LIMIT) {
    throw new FunctionError("rate-limited", 429);
  }
}

async function openAiError(
  response: Response,
  log: RequestLog,
): Promise<FunctionError> {
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

  // The single most useful line in these logs: everything below collapses many
  // distinct upstream problems into a handful of client-facing codes, and this
  // is the only place the original reason survives.
  log.error(
    `OpenAI ${response.status}${code ? ` ${code}` : ""}${
      message ? ` — ${message.slice(0, 300)}` : ""
    }`,
  );

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

// Local-LLM failures never reach the client — analyze() always falls back to
// OpenAI — so unlike FunctionError these carry no client-facing status/code,
// only enough detail to tell a routine rejection ("busy") from a broken Mac
// mini when reading the Function logs.
class LocalLlmError extends Error {
  constructor(
    readonly reason: "busy" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

async function localLlmError(response: Response): Promise<LocalLlmError> {
  // Read as text first: a Cloudflare Tunnel outage replies with an HTML error
  // page, and response.json() would throw before the status could be logged.
  const bodyText = await response.text().catch(() => "");
  let code = "";
  try {
    const parsed = JSON.parse(bodyText) as { error?: { code?: unknown } };
    if (typeof parsed?.error?.code === "string") {
      code = parsed.error.code;
    }
  } catch {
    // Not JSON — classify by status alone below.
  }

  // Only an explicit busy code or a throttle status counts as "busy". A bare
  // 503 stays "unavailable" because cloudflared and the proxy's own upstream
  // failures use it too, and relabelling those would hide a real outage behind
  // a routine message. Misclassification only changes the log line, never the
  // fallback: every LocalLlmError leads to OpenAI regardless of reason.
  const reason =
    code === LOCAL_BUSY_CODE || response.status === 429
      ? "busy"
      : "unavailable";
  return new LocalLlmError(
    reason,
    `HTTP ${response.status}${code ? ` (${code})` : ""} ${bodyText.slice(0, 200)}`,
  );
}

// These logs are the only signal that the Mac mini stopped serving, so keep
// expected rejections at log level and everything else at error level.
function logLocalFallback(error: unknown, log: RequestLog): void {
  if (error instanceof LocalLlmError && error.reason === "busy") {
    log.info(`local LLM busy, using OpenAI — ${error.message}`);
    return;
  }
  // AbortSignal.timeout rejects with a DOMException named "TimeoutError";
  // transport-level failures (DNS, TLS, refused connection) are TypeErrors.
  if ((error as { name?: string })?.name === "TimeoutError") {
    log.error(
      `local LLM produced nothing within ${LOCAL_LLM_TIMEOUT_MS}ms, using OpenAI`,
    );
    return;
  }
  log.error(
    `local LLM unavailable, using OpenAI — ${
      error instanceof Error ? `${error.name}: ${error.message}` : error
    }`,
  );
}

interface ChatTarget {
  // Picks the error classifier: local failures are swallowed into a fallback,
  // so they must not be mapped onto client-facing OpenAI error codes.
  kind: "local" | "openai";
  url: string;
  apiKey: string;
  model: string;
  // OpenAI reasoning-family models reject max_tokens, while Ollama's
  // OpenAI-compatible layer only understands max_tokens — so the field
  // name is per-target instead of hardcoded.
  maxTokensField: "max_completion_tokens" | "max_tokens";
  // Ollama-only: "none" disables thinking-model reasoning traces, which
  // otherwise multiply latency (~85s vs ~11s measured) and can corrupt the
  // JSON output. Must be OMITTED for OpenAI — gpt-4o-mini rejects it.
  reasoningEffort?: "none";
  timeoutMs?: number;
}

async function requestAnalysis(
  target: ChatTarget,
  userContent: Array<Record<string, unknown>>,
  log: RequestLog,
): Promise<unknown> {
  log.debug(`chat → ${target.kind} ${target.model}`);
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify({
      model: target.model,
      [target.maxTokensField]: 1200,
      ...(target.reasoningEffort
        ? { reasoning_effort: target.reasoningEffort }
        : {}),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
    signal:
      target.timeoutMs === undefined
        ? undefined
        : AbortSignal.timeout(target.timeoutMs),
  });

  if (!response.ok) {
    throw target.kind === "local"
      ? await localLlmError(response)
      : await openAiError(response, log);
  }
  const body = await response.json();
  const raw = body?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    log.error(`chat ${target.kind} returned no message content`);
    throw new FunctionError("invalid-response", 502);
  }
  try {
    return JSON.parse(raw);
  } catch {
    // The model emitted something that is not JSON. Its length alone usually
    // says which failure it is — an empty string, a truncated answer, or a
    // ```json fence. The text itself paraphrases the diary, so it is only
    // logged when someone has deliberately turned debugging on.
    log.error(`chat ${target.kind} returned ${raw.length} chars of non-JSON`);
    log.debug(`non-JSON content: ${raw.slice(0, 500)}`);
    throw new FunctionError("invalid-response", 502);
  }
}

async function analyze(
  input: unknown,
  apiKey: string,
  log: RequestLog,
): Promise<unknown> {
  if (typeof input !== "object" || input === null) {
    throw new FunctionError("invalid-input", 400);
  }
  const record = input as Record<string, unknown>;
  const title = requireString(record.title, "title");
  const content = requireString(record.content, "content");
  const weather = requireString(record.weather, "weather");

  // Sizes only. The diary text is exactly the thing the consent notice promises
  // goes to the model and nowhere else.
  log.debug(
    `analyze input — title ${title.length}, content ${content.length}, photo ${
      typeof record.photoDataUrl === "string"
        ? `${Math.round(record.photoDataUrl.length / 1365)}KB`
        : "none"
    }`,
  );

  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `제목: ${title}\n날씨: ${weather}\n일기:\n${content}`,
    },
  ];
  if (typeof record.photoDataUrl === "string") {
    userContent.push({
      type: "image_url",
      image_url: { url: record.photoDataUrl, detail: "low" },
    });
  }

  // Local-first: when LOCAL_LLM_BASE_URL is configured, try the self-hosted
  // Ollama proxy and fall back to OpenAI on ANY failure, so the mini being
  // offline degrades to the paid path instead of breaking analysis. The proxy's
  // single-flight gate turns "already generating for someone else" into an
  // immediate LOCAL_BUSY_CODE rejection, so a second concurrent diary reaches
  // OpenAI right away instead of queueing behind the first one.
  const localBaseUrl = Deno.env.get("LOCAL_LLM_BASE_URL")?.replace(/\/+$/, "");
  if (localBaseUrl) {
    try {
      return await requestAnalysis(
        {
          kind: "local",
          url: `${localBaseUrl}/v1/chat/completions`,
          apiKey: Deno.env.get("LOCAL_LLM_API_KEY") ?? "",
          model: Deno.env.get("LOCAL_LLM_MODEL") || "gemma4:12b-64k",
          maxTokensField: "max_tokens",
          reasoningEffort: "none",
          timeoutMs: LOCAL_LLM_TIMEOUT_MS,
        },
        userContent,
        log,
      );
    } catch (error) {
      logLocalFallback(error, log);
    }
  }

  return requestAnalysis(
    {
      kind: "openai",
      url: "https://api.openai.com/v1/chat/completions",
      apiKey,
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
      maxTokensField: "max_completion_tokens",
    },
    userContent,
    log,
  );
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const match = /^data:([^;]+);base64$/.exec(dataUrl.slice(0, comma));
  if (comma === -1 || !match) {
    throw new FunctionError("invalid-image", 400);
  }

  // atob throws a DOMException on malformed base64. Without this guard it would
  // escape as a generic api-error 500 and be classified as refundable, even
  // though a broken payload is the caller's fault and must not be refunded.
  let binary: string;
  try {
    binary = atob(dataUrl.slice(comma + 1));
  } catch {
    throw new FunctionError("invalid-image", 400);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] });
}

async function sketch(
  photoDataUrl: unknown,
  apiKey: string,
  log: RequestLog,
): Promise<unknown> {
  const photo = requireString(photoDataUrl, "image");
  const quality = Deno.env.get("OPENAI_IMAGE_QUALITY") || "medium";
  if (!["low", "medium", "high"].includes(quality)) {
    throw new FunctionError("invalid-image-quality", 500);
  }

  const model = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-1";
  log.debug(
    `sketch → ${model} quality=${quality}, photo ${Math.round(photo.length / 1365)}KB`,
  );

  const form = new FormData();
  form.append("model", model);
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

  if (!response.ok) throw await openAiError(response, log);
  const body = await response.json();
  const imageBase64 = body?.data?.[0]?.b64_json;
  if (typeof imageBase64 !== "string" || imageBase64 === "") {
    log.error("OpenAI returned an images/edits body with no b64_json");
    throw new FunctionError("invalid-response", 502);
  }
  log.debug(`sketch ok — image ${Math.round(imageBase64.length / 1365)}KB`);
  return { imageBase64 };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return responseJson({ code: "method-not-allowed" }, 405);
  }

  const log = new RequestLog();
  // Held outside the try so the catch can tell "nothing was consumed yet" from
  // "one request is charged and may need giving back".
  let reservation: Reservation | null = null;
  // Same reason: the catch names the action that failed, and a body that never
  // parsed still has to log something.
  let action = "(unparsed)";

  try {
    const body = await request.json();
    if (typeof body?.action === "string") {
      action = body.action;
    }

    // The country is on every request line on purpose: the region gate depends
    // on a header Supabase does not promise to forward, so this is how we find
    // out whether it arrives at all. The IP itself is never logged — it is
    // hashed before storage precisely so it does not sit around in the clear.
    const country = requestCountry(request);
    log.info(
      `${action} — country=${country ?? "none"}, client-id=${
        request.headers.get("x-diary-client-id") ? "present" : "none"
      }, bytes=${request.headers.get("content-length") ?? "?"}`,
    );

    // Routed before the OPENAI_API_KEY check on purpose: a missing key is a
    // server misconfiguration that must not break the usage counters, and
    // answering a status request with invalid-key would be actively misleading.
    if (body?.action === "quota-status") {
      enforceStatusLimit(
        requireString(request.headers.get("x-diary-client-id"), "client-id"),
      );
      const quota = await readQuota(request, log);
      log.debug(
        `quota-status ok — sketch ${quota.sketch.used}/${quota.sketch.limit}, analyze ${quota.analyze.used}/${quota.analyze.limit}`,
      );
      return responseJson({ quota });
    }
    if (body?.action !== "analyze" && body?.action !== "sketch") {
      throw new FunctionError("invalid-action", 400);
    }

    // Before reserveQuota, so a refused caller consumes nothing and there is
    // nothing to refund. quota-status is deliberately left open above: it is
    // how the client finds out it is blocked, and it costs no money.
    if (!regionAllowed(country)) {
      throw new FunctionError("region-blocked", 403);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new FunctionError("invalid-key", 500);

    // Reserve before validating the payload: a junk request must still count
    // against the shared IP budget, or throwing garbage at this endpoint would
    // be a free way to probe it.
    reservation = await reserveQuota(request, body.action, log);
    const result =
      body.action === "analyze"
        ? await analyze(body.input, apiKey, log)
        : await sketch(body.photoDataUrl, apiKey, log);
    log.info(`${action} ok`);
    return responseJson(withQuota(result, reservation.snapshot));
  } catch (error) {
    // Classifying in one place covers every failure — including the ones that
    // are not FunctionErrors, like a bug in our own code — and lets the
    // corrected snapshot ride along on the error response.
    let quota =
      reservation?.snapshot ??
      (error instanceof QuotaError ? error.quota : undefined);
    // Whether the caller kept the charge is the question every quota complaint
    // turns into, so the outcome of that decision goes in the log line.
    let charge = reservation === null ? "" : ", charged";
    if (reservation !== null && shouldRefund(error)) {
      const refreshed = await refundQuota(reservation, log);
      charge = refreshed === null ? ", refund-failed" : ", refunded";
      quota = refreshed ?? quota;
    }

    if (error instanceof FunctionError) {
      log.error(`${action} failed — ${error.code} ${error.status}${charge}`);
      return responseJson(
        { code: error.code, ...(quota ? { quota } : {}) },
        error.status,
      );
    }
    // Not a FunctionError: our own bug, or something never classified. The
    // stack is the only thing that helps here, and it is too long for a line
    // every deployment pays for.
    log.error(
      `${action} crashed${charge} — ${
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      }`,
    );
    if (error instanceof Error && typeof error.stack === "string") {
      log.debug(error.stack.slice(0, 2000));
    }
    return responseJson(
      { code: "api-error", ...(quota ? { quota } : {}) },
      500,
    );
  }
});
