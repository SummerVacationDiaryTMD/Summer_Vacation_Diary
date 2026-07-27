# API 명세

[README로 돌아가기](../README.md) · [기능 명세](./functional-specification.md) · [ERD](./erd.md) · [보안·데이터 처리](./security.md)

## 문서 범위

이 저장소에는 HTTP 서버 구현이나 OpenAPI 파일이 없습니다. 아래 명세는 클라이언트가 실제로 호출하고 검증하는 Supabase Edge Function 계약입니다.

- **확인된 범위:** endpoint 조합, method, headers, action별 요청 body, 클라이언트가 읽는 응답 필드, 클라이언트 오류 매핑
- **확인 필요:** 서버의 요청 validator, 정확한 성공 status, action별 제한값, 원자적 차감·환불 구현, OpenAI 요청, 로그·보존 정책
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
| `resetAt`           | 파싱 가능한 ISO date string                                 |
| `blocked`           | `null`, `device`, `ip-burst`, `ip-daily`, `service` 중 하나 |
| `region.allowed`    | boolean. 누락 시 클라이언트는 `true`로 호환 처리            |
| `region.country`    | ISO 3166-1 alpha-2 string 또는 `null`로 기대                |
| `testMode`          | `true`일 때만 true, 누락 시 false                           |

정확한 limit 숫자는 서버 소스가 없어 `확인 필요`입니다.

## A-01 사용량 조회

### 요청

```json
{
  "action": "quota-status"
}
```

- **목적:** 작업을 차감하지 않고 현재 사용량과 지역 상태를 조회
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

## A-02 사진 그림 변환

### 요청

```json
{
  "action": "sketch",
  "photoDataUrl": "data:image/jpeg;base64,..."
}
```

| 필드           | 타입   | 클라이언트 조건             |
| -------------- | ------ | --------------------------- |
| `action`       | string | 항상 `sketch`               |
| `photoDataUrl` | string | F-03에서 만든 JPEG data URL |

- **timeout:** 120초
- **Path·Query parameter:** 없음
- **권한:** 공통 publishable key와 익명 식별 header
- **서버 validation:** MIME·Base64·크기·콘텐츠 검사 규칙은 확인 필요
- **rate limit:** 제한 존재를 전제로 클라이언트가 오류 code와 quota를 처리하지만 숫자는 확인 필요

### 성공 응답

```ts
interface SketchResponse {
  imageBase64: string;
  quota: QuotaSnapshot;
}
```

- `imageBase64`는 비어 있지 않은 string이어야 합니다.
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

`content-blocked`, `invalid-image`는 클라이언트 ledger에서 차감된 결과로 간주합니다. 실제 서버 환불 정책은 확인 필요합니다.

- **관련 기능:** F-05, F-10
- **구현 파일:** `src/services/styleTransfer.ts`, `src/services/supabaseEdge.ts`, `src/services/sketchLedger.ts`

## A-03 일기 분석

### 요청

```json
{
  "action": "analyze",
  "input": {
    "photoDataUrl": "data:image/jpeg;base64,...",
    "title": "계곡에서",
    "content": "가족과 계곡에서 물놀이를 해서 정말 즐거웠다.",
    "weather": "맑음"
  }
}
```

| 필드                 | 타입             | 클라이언트 조건                                  |
| -------------------- | ---------------- | ------------------------------------------------ |
| `action`             | string           | 항상 `analyze`                                   |
| `input.photoDataUrl` | string 또는 null | 현재 사진 data URL                               |
| `input.title`        | string           | 화면 최대 15자, 공백만 입력 불가                 |
| `input.content`      | string           | 화면 최대 65자, 진입 시 공백 제거 기준 20자 이상 |
| `input.weather`      | string           | 한국어 표시값 5개 중 하나                        |

- **timeout:** 30초
- **Path·Query parameter:** 없음
- **권한:** 공통 publishable key와 익명 식별 header
- **서버 validation·rate limit:** 구현과 정확한 값은 확인 필요

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
  quota: QuotaSnapshot;
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
