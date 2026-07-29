# API 명세

[README로 돌아가기](../README.md) · [기능 명세](./functional-specification.md) · [ERD](./erd.md) · [보안·데이터 처리](./security.md)

## 문서 범위

아래 명세는 클라이언트가 실제로 호출하고 검증하는 Supabase Edge Function 계약과 제공된 서버 구현을 기준으로 합니다.

- **확인된 범위:** endpoint 조합, method, headers, action별 요청 body, 클라이언트가 읽는 응답 필드, 클라이언트 오류 매핑
- **확인 필요:** 운영 배포 상태, OpenAI 응답 품질, 로그·보존 정책
- **근거:** `src/services/supabaseEdge.ts`, `src/services/diaryAnalysis.ts`, `src/services/styleTransfer.ts`, `src/services/aiQuotaStore.ts`, `src/hooks/useAiQuota.ts`

이 API는 이 앱의 내부 외부-service 경계이며, 저장소가 공개 HTTP API로 제공하는 서버 구현은 아닙니다.

## 공통 계약

| 항목           | 값                                                                               |
| -------------- | -------------------------------------------------------------------------------- |
| Method         | `POST`                                                                           |
| Endpoint       | `{VITE_SUPABASE_URL}/functions/v1/diary-ai`                                      |
| Content-Type   | `application/json`                                                               |
| Supabase key   | `apikey: {VITE_SUPABASE_PUBLISHABLE_KEY}`                                        |
| 익명 요청 식별 | `x-diary-client-id: toss:{anonymousKey}` 또는 `web:{uuid}` 또는 `session:{uuid}` |
| 사용자 인증    | 없음. `Authorization` header를 보내지 않음                                       |
| 성공 판정      | Fetch `response.ok === true`인 2xx 응답                                          |
| 응답 형식      | JSON                                                                             |

두 `VITE_SUPABASE_*` 값이 모두 있어야 호출합니다. 하나라도 없으면 클라이언트가 mock 또는 로컬 필터를 사용합니다.

### 공통 quota 응답

성공과 오류를 포함한 모든 서버 응답은 다음 `quota`를 포함하는 계약으로 사용됩니다. 필드가 없거나 잘못되어도 본 작업 응답 자체를 클라이언트가 곧바로 실패시키지는 않습니다.

```json
{
  "quota": {
    "sketch": {
      "used": 0,
      "limit": 0,
      "remaining": 0
    },
    "analyze": {
      "used": 0,
      "limit": 0,
      "remaining": 0
    },
    "all": {
      "used": 0,
      "limit": 3,
      "remaining": 3
    },
    "resetAt": "2026-07-29T00:00:00.000Z",
    "blocked": null,
    "region": {
      "allowed": true,
      "country": "KR"
    },
    "testMode": false
  }
}
```

| 필드                | 타입·제약                                                   |
| ------------------- | ----------------------------------------------------------- |
| `sketch`, `analyze` | `used`, `limit`, `remaining`이 모두 number                  |
| `all`               | 통합 AI 검사 카운터. 이전 서버와의 호환을 위해 누락 허용  |
| `resetAt`           | 파싱 가능한 ISO date string                                 |
| `blocked`           | `null`, `device`, `ip-burst`, `ip-daily`, `service` 중 하나 |
| `region.allowed`    | boolean. 누락 시 클라이언트는 `true`로 호환 처리            |
| `region.country`    | ISO 3166-1 alpha-2 string 또는 `null`로 기대                |
| `testMode`          | `true`일 때만 true, 누락 시 false                           |

클라이언트는 두 작업을 사용자에게 별도 기회로 노출하지 않습니다. 서버가
`quota.all`을 반환하면 이를 통합 `AI 검사 기회`의 권위값으로 사용합니다.

이전 Function처럼 `all`이 없을 때만 배포 호환 fallback으로 다음 값을
계산합니다.

```ts
limit = Math.min(quota.sketch.limit, quota.analyze.limit);
used = Math.min(Math.max(quota.sketch.used, quota.analyze.used), limit);
remaining = Math.max(limit - used, 0);
```

진행 중인 그림 요청은 `quota.sketch.used`에 로컬 ledger 수량을 먼저
합산한 뒤 같은 계산을 적용합니다. 이 fallback은 기존 서버에서 통합
3회를 보수적으로 표시하고 선차단하기 위한 것이며, 서로 다른 action의
사용량이 엇갈린 뒤 한쪽이 따라잡는 경우에는 매 실행마다 정확히 1회가
증가했는지 판별할 수 없습니다.

새 서버는 필요한 작업을 하나의 `inspect` 요청으로 묶고, 사용자 `all`
counter와 IP counter를 요청당 한 번만 원자적으로 차감합니다. 서비스
counter는 실제 실행한 sketch·analyze 작업별로 유지합니다.

## A-01 사용량 조회

### 요청

```json
{
  "action": "quota-status"
}
```

- **목적:** 작업을 차감하지 않고 통합 AI 검사 사용량과 지역 상태를 조회
- **timeout:** 10초
- **Path·Query parameter:** 없음
- **권한:** 공통 publishable key와 익명 식별 header
- **Request validation:** 클라이언트는 고정 문자열만 전송. 서버 검증은 확인 필요

### 성공 응답

공통 `quota` 객체를 기대합니다. 추가 필드는 클라이언트가 무시합니다.

### 오류 처리

모든 오류를 호출부에서 삼키고 사용량 표시를 `unknown`으로 유지합니다. 이 조회 실패만으로 제작 흐름을 차단하지 않습니다.

- **관련 기능:** F-01, F-10
- **구현 파일:** `src/hooks/useAiQuota.ts`, `src/services/supabaseEdge.ts`

## A-02 통합 AI 검사

### 요청

```json
{
  "action": "inspect",
  "runSketch": true,
  "runAnalyze": true,
  "photoDataUrl": "data:image/jpeg;base64,...",
  "input": {
    "photoDataUrl": "data:image/jpeg;base64,...",
    "content": "가족과 계곡에서 물놀이를 해서 정말 즐거웠다."
  }
}
```

| 필드                 | 타입             | 클라이언트 조건                          |
| -------------------- | ---------------- | ---------------------------------------- |
| `action`             | string           | 항상 `inspect`                           |
| `runSketch`          | boolean          | 새 그림이 필요할 때 true                 |
| `runAnalyze`         | boolean          | 새 본문 분석이 필요할 때 true            |
| `photoDataUrl`       | string           | `runSketch=true`일 때 JPEG data URL      |
| `input.photoDataUrl` | string 또는 null | `runAnalyze=true`일 때 현재 사진         |
| `input.content`      | string           | `runAnalyze=true`일 때 현재 일기 본문    |

- 두 실행 값 중 하나 이상이 true여야 합니다.
- **timeout:** 150초
- **Path·Query parameter:** 없음
- **권한:** 공통 publishable key와 익명 식별 header
- **서버 validation:** MIME·Base64·크기·콘텐츠 검사 규칙은 확인 필요
- **rate limit:** 사용자 통합 3회, IP burst 20회/10분, IP 100회/일. 서비스 한도는 sketch 150회/일, analyze 250회/일

### 성공 응답

```ts
interface InspectionResponse {
  imageBase64?: string;
  analysis?: Record<string, unknown>;
  quota: QuotaSnapshot;
}
```

- 요청한 작업의 결과만 응답에 포함됩니다.
- `runSketch=true`이면 `imageBase64`는 비어 있지 않은 string이어야 합니다.
- `runAnalyze=true`이면 `analysis` 객체가 있어야 합니다.
- 클라이언트는 `data:image/jpeg;base64,` prefix를 붙여 디코딩한 뒤 최대 1280px, 품질 0.85 JPEG로 재압축합니다.
- 누락·빈 값·디코딩 실패는 `invalid-response`입니다.

### 오류 응답

클라이언트가 기대하는 최소 body:

```ts
interface ErrorResponse {
  code?: string;
  quota: QuotaSnapshot;
}
```

| HTTP 또는 code                 | 클라이언트 결과    |
| ------------------------------ | ------------------ |
| abort                          | `timeout`          |
| 요청 단계 실패                 | `network`          |
| JSON 파싱 실패                 | `invalid-response` |
| `401`, `403` + 알 수 없는 code | `invalid-key`      |
| `429` + 알 수 없는 code        | `rate-limited`     |
| 알려진 `code`                  | 같은 code를 보존   |

인식하는 server code:

```text
timeout
network
invalid-key
invalid-image
model-unavailable
rate-limited
region-blocked
sketch-daily-limit-exceeded
ip-burst-limit-exceeded
ip-daily-limit-exceeded
service-daily-limit-exceeded
daily-limit-exceeded
quota-exceeded
content-blocked
api-error
invalid-response
```

`content-blocked`, `invalid-image`는 사용자 입력 오류이므로 차감을 유지하고, 그 밖의 서버·네트워크 계열 실패는 서버가 차감을 환불합니다.

- **관련 기능:** F-05, F-10
- **구현 파일:** `src/services/styleTransfer.ts`, `src/services/supabaseEdge.ts`, `src/services/sketchLedger.ts`

## A-03 일기 분석 결과

### 통합 요청의 분석 입력

분석 입력은 A-02의 `inspect` 요청 안에 포함되며 `runAnalyze=true`일 때만
전송됩니다. 결과는 최상위 `analysis` 객체로 반환됩니다.

제목·날짜·날씨는 완성 이미지에만 사용하며 분석 API에는 전송하지 않습니다.

- **timeout:** 통합 요청 기준 150초
- **Path·Query parameter:** 없음
- **권한:** 공통 publishable key와 익명 식별 header
- **서버 validation·rate limit:** A-02의 통합 요청 정책과 동일

### 성공 응답

```ts
interface AnalyzeResponse {
  photo_keywords?: unknown;
  diary_keywords?: unknown;
  emotions?: unknown;
  highlight_words?: unknown;
  highlight_sentence?: unknown;
  star_words?: unknown;
  comment?: unknown;
  stamp?: unknown;
}
```

### 클라이언트 응답 validation

| 필드                 | 처리                                                           |
| -------------------- | -------------------------------------------------------------- |
| `comment`            | 비어 있으면 전체 실패, 50자 초과 시 49자와 말줄임표로 제한     |
| `photo_keywords`     | string 배열에서 최대 3개                                       |
| `diary_keywords`     | string 배열에서 최대 4개, 비속어 제외                          |
| `emotions`           | string 배열에서 최대 3개                                       |
| `highlight_words`    | 본문의 실제 부분 문자열·비속어 아님·일반 강조어 아님, 최대 4개 |
| `highlight_sentence` | 본문의 실제 부분 문자열·비속어 아님·100자 이하, 아니면 null    |
| `star_words`         | 본문의 실제 부분 문자열·비속어 아님, 최대 2개                  |
| `stamp`              | `effort`만 effort, 그 외 값은 great로 정규화                   |

### 오류 응답

최소 body와 HTTP 매핑 방식은 A-02와 같습니다. 인식하는 분석 server code:

```text
timeout
network
invalid-key
rate-limited
region-blocked
analyze-daily-limit-exceeded
ip-burst-limit-exceeded
ip-daily-limit-exceeded
service-daily-limit-exceeded
daily-limit-exceeded
api-error
invalid-response
```

지역·일일 한도 오류는 재시도 불가로 표시하고, timeout·network·burst·일반 API 오류는 재시도 가능으로 표시합니다.

- **관련 기능:** F-06, F-10
- **구현 파일:** `src/services/diaryAnalysis.ts`, `src/hooks/useDiaryAnalysis.ts`, `src/services/supabaseEdge.ts`

## 보안과 공개 범위

- publishable key는 클라이언트 공개 값이며 server secret이 아닙니다.
- OpenAI API key와 Supabase service-role key는 요청이나 저장소에 포함하지 않습니다.
- 사용자 계정 token이나 session 인증은 없습니다.
- `x-diary-client-id`는 남용 방지 힌트이며 인증 수단이 아닙니다.
- 원본 사진과 일기는 JSON request body로 전송됩니다.

자세한 데이터 흐름과 확인 필요 항목은 [보안·데이터 처리](./security.md)를 참고하세요.

## OpenAPI를 생성하지 않은 이유

이 저장소에는 서버 route·validator 구현이 없고, endpoint도 별도 배포된 내부 Edge Function 하나입니다. 클라이언트 기대만으로 기계 판독 가능한 서버 계약을 확정하면 실제 validation과 status를 잘못 선언할 위험이 있어 `openapi.yaml`은 생성하지 않았습니다.

## 관련 문서

- [기능 명세](./functional-specification.md)
- [ERD](./erd.md)
- [아키텍처](./architecture.md)
- [보안·데이터 처리](./security.md)
