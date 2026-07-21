import { createClient } from "npm:@supabase/supabase-js@2";

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
// analysis call consumes one request. Daily windows reset at 00:00 UTC.
const USAGE_LIMITS = {
  shortWindowSeconds: 10 * 60,
  userShort: 5,
  ipShort: 10,
  userDaily: 20,
  ipDaily: 60,
} as const;

const ANALYSIS_PROMPT = `당신은 여름방학 그림일기를 읽고 따뜻한 한줄평을 써 주는 선생님입니다.
사진과 일기를 함께 분석해 다음 키를 가진 JSON 객체만 응답하세요.
- "photo_keywords": 사진 장소·사물·분위기 키워드, 한국어 최대 3개
- "diary_keywords": 일기 주요 키워드, 한국어 최대 4개
- "emotions": 핵심 감정, 한국어 최대 3개
- "highlight_words": 일기 본문에 그대로 등장하는 단어 2~4개
- "highlight_sentence": 본문에 그대로 등장하는 인상적인 문장 1개, 없으면 null
- "comment": 사진과 감정을 함께 담은 존댓말 한 문장, 공백 포함 50자 이내`;

const SKETCH_PROMPT = `Redraw the input photo as an authentic colored-pencil drawing made by a 6–8-year-old child.
Use shaky uneven pencil lines, awkward proportions, flattened perspective, rough dry scribbles, visible paper grain, white gaps, and colors crossing outlines.
Keep the scene recognizable, warm, sincere, naive, asymmetrical, and visibly handmade.
Avoid photorealism, professional illustration, anime, manga, chibi, kawaii, clean line art, smooth gradients, digital painting, perfect anatomy, text, logos, watermarks, borders, and UI elements.`;

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

  // Supabase normally supplies x-forwarded-for. If it is absent, keep the
  // request usable without collapsing every visitor into one shared bucket;
  // the device bucket still enforces the user limits.
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
    // Fail closed: a database outage must not turn into unlimited paid calls.
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

async function analyze(input: unknown, apiKey: string): Promise<unknown> {
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
  if (typeof record.photoDataUrl === "string") {
    userContent.push({
      type: "image_url",
      image_url: { url: record.photoDataUrl, detail: "low" },
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!response.ok) throw await openAiError(response);
  const body = await response.json();
  const raw = body?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new FunctionError("invalid-response", 502);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new FunctionError("invalid-response", 502);
  }
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

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new FunctionError("invalid-key", 500);

    const body = await request.json();
    if (body?.action !== "analyze" && body?.action !== "sketch") {
      throw new FunctionError("invalid-action", 400);
    }

    await enforceUsageLimit(request);
    if (body.action === "analyze") {
      return responseJson(await analyze(body.input, apiKey));
    }
    return responseJson(await sketch(body.photoDataUrl, apiKey));
  } catch (error) {
    if (error instanceof FunctionError) {
      return responseJson({ code: error.code }, error.status);
    }
    console.error(error instanceof Error ? error.message : "Unknown error");
    return responseJson({ code: "api-error" }, 500);
  }
});
