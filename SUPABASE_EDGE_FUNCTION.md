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

클라이언트는 서버 응답을 기다리지 않고 요청을 보내는 순간 그림 횟수를 먼저 셉니다
(`src/services/sketchLedger.ts`). 그림 한 장에 30~60초가 걸리기 때문에, 그렇게
하지 않으면 세 장이 동시에 그려지는 동안 화면은 계속 0회로 보입니다. 사진 한 장에
표 하나이고, 서버가 돈을 받지 않은 실패일 때만 되돌립니다. 이건 사용 흐름을 위한
표시일 뿐 강제 수단이 아니며, 실제 차단은 여전히 서버의 원자적 차감입니다.

### 제한 지역

`sketch`와 `analyze`는 한국(`KR`)에서만 호출할 수 있고, 그 밖의 나라는 **403
`region-blocked`** 로 거절합니다. 사용량을 차감하기 **전에** 검사하므로 거절된
요청은 아무것도 소모하지 않습니다. `quota-status`는 일부러 막지 않습니다 — 클라이언트가
자기가 차단됐다는 사실을 알게 되는 통로이고, 돈이 들지 않기 때문입니다.

나라는 **요청 헤더로만** 판별합니다(`COUNTRY_HEADERS`). Supabase는 Edge Function에
국가 헤더를 준다고 문서화한 적이 없고, 공식 예제조차 `x-forwarded-for`를 외부
지오 서비스에 물어보는 방식입니다. 그래서 **나라를 못 알아내면 통과시킵니다.**
판별 수단이 사라지는 순간 전 세계가 막히는 쪽이 훨씬 큰 사고이고, 하루 비용의
천장은 이미 서비스 전체 상한(sketch 150 / analyze 250)이 잡고 있습니다.

#### 헤더가 실제로 오는지 확인하기

배포 후 `quota-status` 응답의 `quota.region.country`를 봅니다.

| 값     | 뜻                                                                |
| ------ | ----------------------------------------------------------------- |
| `"KR"` | 헤더가 도착합니다. 지역 차단이 실제로 동작합니다.                 |
| `null` | 헤더가 오지 않습니다. 지역 차단은 아무 일도 하지 않는 상태입니다. |

브라우저뿐 아니라 **실제 토스 앱(WebView)에서도** 확인해야 합니다. 토스 앱의 통신이
다른 경로로 나가면 결과가 달라질 수 있습니다. Function 로그에도 요청마다
`country=...`가 찍히니 아래 5절 로그로도 같은 확인이 됩니다.

`null`로 확인되면 선택지는 두 가지입니다. (1) 외부 지오 API(ipinfo.io 등)를
붙인다 — 확실하지만 요청당 지연이 붙고 사용자 IP를 받는 제3자가 생기므로 사진 전송
동의 문구도 고쳐야 합니다. (2) 한국 IP 대역표를 함수에 내장한다 — 제3자도 지연도
없지만 100KB짜리 생성 파일이 하나 늘어납니다.

해외에서 테스트할 방법이 없으면 `ALLOWED_COUNTRIES`를 잠시 `new Set(["JP"])`로
바꿔 한국에서 접속한 사람이 '해외'가 되게 만든 뒤, 안내 팝업과 두 안내 문구,
`sketch`/`analyze`의 403, 그리고 `quota-status`가 여전히 응답하는지를 확인하고
되돌리면 됩니다.

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
생략 시 위 값이 기본값입니다. 자세한 로그가 필요할 때만 `DIARY_AI_DEBUG=true`를
추가로 등록하세요(5절). Supabase가 제공하는 `SUPABASE_URL`과 서버 Secret은
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

## 4. 앱 `.env`

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

이 두 값은 공개 설정입니다. `OPENAI_API_KEY`, `RATE_LIMIT_SALT`, `sb_secret_*`,
`service_role` 키는 절대 `VITE_*`로 넣지 마세요.

## 5. 로그 보기

Function 안의 `console.log`/`console.error`는 Supabase Dashboard의
**Logs → Edge Functions**에 그대로 쌓입니다. 함수 이름으로 걸러 `diary-ai`만 볼 수
있습니다. CLI로는 `npx supabase functions logs diary-ai`, 로컬 실행
(`npx supabase functions serve`)에서는 터미널에 바로 찍힙니다.

제약이 셋 있습니다.

| 항목       | 값                  |
| ---------- | ------------------- |
| 한 줄 길이 | 최대 10,000자       |
| 발생 빈도  | 함수당 10초에 100건 |
| 보관 기간  | Free 1일 / Pro 7일  |

특히 **Free 플랜은 하루**입니다. 어제 저녁에 난 오류는 오늘 아침이면 없습니다.
오래 보관하려면 Pro 이상에서 Log Drains를 걸어야 합니다.

### 줄 읽는 법

요청마다 짧은 id와 경과 시간이 앞에 붙습니다. 그림 한 장이 30~60초씩 걸려 여러
요청이 겹치기 때문에, id가 없으면 서로 다른 사람의 줄이 섞여 읽을 수 없습니다.

```
[k3f9a2 +0ms] sketch — country=KR, client-id=present, bytes=284113
[k3f9a2 +38124ms] sketch ok
[q7b1c8 +0ms] analyze — country=KR, client-id=present, bytes=51204
[q7b1c8 +240ms] local LLM busy, using OpenAI — HTTP 429 (busy)
[q7b1c8 +3187ms] analyze ok
[z0d4e6 +812ms] OpenAI 429 insufficient_quota — You exceeded your current quota
[z0d4e6 +1450ms] sketch failed — quota-exceeded 429, refunded
```

- `country=` — 지역 차단이 의존하는 헤더가 실제로 도착하는지 확인하는 자리입니다.
- 실패 줄의 `refunded` / `charged` / `refund-failed` — 사용 횟수를 되돌렸는지
  알려줍니다. 사용량 문의는 대개 이 한 단어로 끝납니다.
- `OpenAI ...` 줄 — 클라이언트에게는 몇 개 코드로 뭉뚱그려 나가기 때문에, 원래
  이유가 남는 곳은 여기뿐입니다.

함수가 새로 뜰 때마다 설정 점검용 한 줄도 남습니다. 값은 절대 찍지 않고 있는지
없는지만 남깁니다.

```
diary-ai boot — OPENAI_API_KEY=set RATE_LIMIT_SALT=set SUPABASE_URL=set ...
```

### 자세한 로그 켜기

Secret에 `DIARY_AI_DEBUG=true`를 등록하면 아래가 더 남습니다. 지우면 기본 줄만
남습니다.

- 입력 크기 — 제목·일기 글자 수, 사진 KB (**내용은 남기지 않습니다**)
- 네 가지 사용량 카운터의 현재 값과 판정 결과
- 모델이 JSON이 아닌 것을 뱉었을 때 그 앞 500자
- 분류되지 않은 예외의 스택

일기 본문, 사진, 원본 IP는 **어떤 모드에서도** 로그에 남기지 않습니다. 앞의 둘은
앱이 사용자에게 어디로 가는지 약속한 대상이고, IP를 저장 전에 해시하는 이유가 바로
평문으로 남지 않게 하려는 것이기 때문입니다.
