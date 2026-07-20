# Supabase `diary-ai` Edge Function

앱은 `https://<project-ref>.supabase.co/functions/v1/diary-ai`를 호출합니다.
아래 코드를 Supabase Dashboard의 `diary-ai` Edge Function에 붙여 넣으세요.

## 1. Secret 등록

Dashboard의 **Edge Functions → Secrets**에서 등록하거나 CLI를 사용합니다.

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set OPENAI_MODEL=gpt-4o-mini
supabase secrets set OPENAI_IMAGE_MODEL=gpt-image-1
supabase secrets set OPENAI_IMAGE_QUALITY=medium
```

`OPENAI_API_KEY`만 필수이고 나머지는 생략해도 위 값이 기본값으로 적용됩니다.

## 2. Function 코드

```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

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
    if (body?.action === "analyze") {
      return responseJson(await analyze(body.input, apiKey));
    }
    if (body?.action === "sketch") {
      return responseJson(await sketch(body.photoDataUrl, apiKey));
    }
    throw new FunctionError("invalid-action", 400);
  } catch (error) {
    if (error instanceof FunctionError) {
      return responseJson({ code: error.code }, error.status);
    }
    console.error(error instanceof Error ? error.message : "Unknown error");
    return responseJson({ code: "api-error" }, 500);
  }
});
```

## 3. Auth 설정과 배포

현재 앱은 Supabase Auth 로그인을 사용하지 않으므로 `diary-ai`의
**Verify JWT를 끄고** 배포해야 `sb_publishable_*` 키로 호출할 수 있습니다.

```bash
supabase functions deploy diary-ai --no-verify-jwt
```

Dashboard에서 직접 만들 경우에도 **Verify JWT** 옵션을 비활성화하세요.

> `sb_publishable_*` 키는 공개 키입니다. OpenAI 키 자체는 숨겨지지만, 로그인 없이
> 호출할 수 있는 함수는 비용 남용에 노출됩니다. 공개 서비스 전에 Supabase Auth,
> 요청 횟수 제한, 사용자별 quota 중 적어도 하나를 추가하세요.

## 4. 앱 `.env`

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

이 두 값은 공개 설정입니다. `OPENAI_API_KEY`, `sb_secret_*`, `service_role` 키는
절대 `VITE_*`로 넣지 마세요.
