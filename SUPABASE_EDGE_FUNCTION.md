# Supabase `diary-ai` Edge Function

앱은 `https://<project-ref>.supabase.co/functions/v1/diary-ai`를 호출합니다.
Edge Function의 기준 코드는 [`supabase/functions/diary-ai/index.ts`](./supabase/functions/diary-ai/index.ts)입니다.

## 1. 사용량 제한 테이블 설치

Supabase Dashboard의 **SQL Editor**에서
[`supabase/migrations/20260725000000_rework_diary_ai_quota.sql`](./supabase/migrations/20260725000000_rework_diary_ai_quota.sql)을 실행합니다.

이 파일은 기존 테이블·함수를 지우고 다시 만드는 방식이라 몇 번 실행해도 결과가
같습니다. 이전
[`20260721000000_create_diary_ai_rate_limits.sql`](./supabase/migrations/20260721000000_create_diary_ai_rate_limits.sql)은
기록용으로만 남겨 두었으니 새로 설치할 때 실행하지 마세요.

### 설치 확인

실행한 뒤 같은 SQL Editor에서 아래 쿼리를 돌려 함수가 정확히 3개인지 확인합니다.

```sql
select proname, pronargs from pg_proc where proname like '%diary_ai_quota%';
```

| proname                  | pronargs |
| ------------------------ | -------- |
| `consume_diary_ai_quota` | 9        |
| `read_diary_ai_quota`    | 4        |
| `refund_diary_ai_quota`  | 5        |

PostgreSQL은 함수를 *이름 + 인자 타입 목록*으로 구분합니다. 그래서 인자 개수가
다른 옛 버전이 남아 있으면 같은 이름으로 함께 존재할 수 있고, Edge Function이 어느
쪽을 호출할지 모호해집니다. 4행 이상 나오면 남은 행을
`drop function public.<이름>(<인자 타입 목록>);`으로 직접 지우세요.

### 제한값

기기·IP 원문은 저장하지 않고 `RATE_LIMIT_SALT`와 함께 SHA-256으로 해시한 값만
저장합니다. 제한값은 Edge Function 상단 `USAGE_LIMITS` 한곳에서 바꿉니다.

| 범위                       | 한도  | 창   |
| -------------------------- | ----- | ---- |
| 기기 sketch                | 3회   | 하루 |
| 기기 analyze               | 5회   | 하루 |
| IP (sketch + analyze 합산) | 20회  | 10분 |
| IP (sketch + analyze 합산) | 100회 | 하루 |
| 서비스 전체 sketch         | 150회 | 하루 |
| 서비스 전체 analyze        | 250회 | 하루 |

하루 경계는 UTC 00:00, 곧 한국 시간 오전 9시입니다. 앱 문구도 "내일 아침 9시부터
다시 이용할 수 있어요"로 맞춰져 있습니다.

차감은 **예약 후 환불** 방식입니다. 유료 호출을 보내기 전에 먼저 차감하고, 사용자
잘못이 아닌 실패(모델 오류, 네트워크 등)일 때만 되돌립니다. 사용자 잘못으로 보는
실패 — `content-blocked`, `invalid-image`, 각 입력 검증 실패, 즉 HTTP 400으로
끝나는 모든 응답 — 는 환불하지 않습니다.

모든 응답 본문에는 현재 사용량 스냅샷이 함께 실려 오고, 클라이언트는 `quota-status`
액션으로 따로 조회할 수도 있습니다. 이 액션은 `OPENAI_API_KEY` 없이도 동작합니다.

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

Dashboard에서 `diary-ai` 함수를 만든 다음, 아래 **세 파일을 모두** 만들어야 합니다.
`index.ts`가 프롬프트 두 개를 `import`하므로 `index.ts`만 붙여 넣으면 배포가
실패합니다.

| Dashboard 파일명     | 원본                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `index.ts`           | [`supabase/functions/diary-ai/index.ts`](./supabase/functions/diary-ai/index.ts)                     |
| `prompt_analysis.ts` | [`supabase/functions/diary-ai/prompt_analysis.ts`](./supabase/functions/diary-ai/prompt_analysis.ts) |
| `prompt_sketch.ts`   | [`supabase/functions/diary-ai/prompt_sketch.ts`](./supabase/functions/diary-ai/prompt_sketch.ts)     |

현재 앱은 Supabase Auth 로그인을 사용하지 않으므로 **Verify JWT를 꺼야** 공개
`sb_publishable_*` 키로 호출할 수 있습니다. 사용량 제한은 JWT 대신 함수 내부의
기기·IP 이중 제한으로 적용됩니다.

CLI를 쓰는 경우 설정은 [`supabase/config.toml`](./supabase/config.toml)에 포함되어
있습니다.

```bash
supabase functions deploy diary-ai --no-verify-jwt
```

### 배포 순서

각 단계는 앞 단계와 호환되므로 아래 순서대로 하나씩 올리면 중간에 앱이 깨지지
않습니다.

1. 1절의 마이그레이션 SQL
2. `index.ts` (+ 프롬프트 두 파일)
3. 클라이언트 빌드 배포
4. `index_debug.ts` — 디버그용 별도 함수라 마지막에 올려도 됩니다

## 4. 앱 `.env`

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

이 두 값은 공개 설정입니다. `OPENAI_API_KEY`, `RATE_LIMIT_SALT`, `sb_secret_*`,
`service_role` 키는 절대 `VITE_*`로 넣지 마세요.
