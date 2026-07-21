# Supabase `diary-ai` Edge Function

앱은 `https://<project-ref>.supabase.co/functions/v1/diary-ai`를 호출합니다.
Edge Function의 기준 코드는 [`supabase/functions/diary-ai/index.ts`](./supabase/functions/diary-ai/index.ts)입니다.

## 1. 사용량 제한 테이블 설치

Supabase Dashboard의 **SQL Editor**에서
[`supabase/migrations/20260721000000_create_diary_ai_rate_limits.sql`](./supabase/migrations/20260721000000_create_diary_ai_rate_limits.sql)을 실행합니다.

기기·IP 원문은 저장하지 않고 `RATE_LIMIT_SALT`와 함께 SHA-256으로 해시한 값만
저장합니다. 현재 제한은 Edge Function 상단 `USAGE_LIMITS` 한곳에서 바꿀 수 있습니다.

- 10분당: 기기 5회, IP 10회
- 하루(UTC 기준): 기기 20회, IP 60회
- 일기 분석과 그림 변환은 각각 1회로 계산

## 2. Secret 등록

Dashboard의 **Edge Functions → Secrets**에서 등록하거나 CLI를 사용합니다.

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set RATE_LIMIT_SALT=충분히-길고-무작위인-값
supabase secrets set OPENAI_MODEL=gpt-4o-mini
supabase secrets set OPENAI_IMAGE_MODEL=gpt-image-1
supabase secrets set OPENAI_IMAGE_QUALITY=medium
```

`OPENAI_API_KEY`, `RATE_LIMIT_SALT`만 직접 등록하면 됩니다. OpenAI 모델 관련 값은
생략 시 위 값이 기본값입니다. Supabase가 제공하는 `SUPABASE_URL`과 서버 Secret은
Edge Function에서 자동으로 사용합니다.

## 3. Function 생성 및 배포

Dashboard에서 `diary-ai` 함수를 만든 다음
[`supabase/functions/diary-ai/index.ts`](./supabase/functions/diary-ai/index.ts)의 전체
내용을 붙여 넣으세요.

현재 앱은 Supabase Auth 로그인을 사용하지 않으므로 **Verify JWT를 꺼야** 공개
`sb_publishable_*` 키로 호출할 수 있습니다. 사용량 제한은 JWT 대신 함수 내부의
기기·IP 이중 제한으로 적용됩니다.

CLI를 쓰는 경우 설정은 [`supabase/config.toml`](./supabase/config.toml)에 포함되어
있습니다.

```bash
supabase functions deploy diary-ai --no-verify-jwt
```

## 4. 앱 `.env`

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

이 두 값은 공개 설정입니다. `OPENAI_API_KEY`, `RATE_LIMIT_SALT`, `sb_secret_*`,
`service_role` 키는 절대 `VITE_*`로 넣지 마세요.
