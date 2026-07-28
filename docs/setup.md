# 개발 환경 설정

[README로 돌아가기](../README.md) · [아키텍처](./architecture.md) · [배포](./deployment.md)

## 요구 환경

| 항목          | 요구사항                             | 근거                               |
| ------------- | ------------------------------------ | ---------------------------------- |
| Node.js       | `^18.0.0`, `^20.0.0` 또는 `>=22.0.0` | 설치된 Vite 6.4.3의 `engines.node` |
| 패키지 매니저 | npm                                  | `package-lock.json` lockfile v3    |
| 기본 개발 OS  | macOS                                | 저장소 작업 지침                   |
| 브라우저 실행 | 최신 Canvas·Web Crypto 지원 브라우저 | 이미지 처리와 익명 ID 생성 코드    |
| 샌드박스 실행 | Toss 샌드박스 앱과 콘솔 등록 앱      | `granite dev` 흐름                 |

저장소는 Node 버전을 `.nvmrc`, `.node-version`, `package.json#engines`로 고정하지 않습니다. 위 범위는 직접 의존하는 Vite의 지원 범위입니다.

## 설치

```bash
git clone https://github.com/SummerVacationDiaryTMD/summer-vacation-diary.git
cd summer-vacation-diary
npm ci
```

`package-lock.json`과 정확히 맞춘 설치에는 `npm ci`를 사용합니다. 의존성을 의도적으로 갱신할 때만 `npm install`과 lockfile 변경을 함께 검토합니다.

## 가장 단순한 실행: 브라우저 체험 모드

```bash
npm run dev:web
```

`http://localhost:5173`을 엽니다.

- Supabase 설정 없음: 외부로 사진·일기를 보내지 않음
- `VITE_AI_TEST_MODE` 미설정: 로컬 연필 필터 + mock 분석
- 토스 저장 API: `<a download>`로 대체
- 토스 공유 API: Web Share 또는 현재 URL 복사로 대체

## 환경 변수

```bash
cp .env.example .env
```

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_AI_TEST_MODE=true
```

| 변수                            | 기본값                              | 동작                         |
| ------------------------------- | ----------------------------------- | ---------------------------- |
| `VITE_SUPABASE_URL`             | 빈 값                               | Function base URL            |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 빈 값                               | `apikey` header              |
| `VITE_AI_TEST_MODE`             | 코드 기본 `false`, 예시 파일 `true` | `true`면 그림 생성 요청 생략 |
| `AIT_DEV_HOST`                  | LAN IPv4 자동 탐색 후 `localhost`   | 샌드박스가 접속할 개발 host  |

두 Supabase 값 중 하나만 있으면 `isSupabaseConfigured`가 false가 되어 전체 외부 요청을 사용하지 않습니다.

### 비밀값 규칙

`VITE_*`는 Vite가 번들에 포함하므로 공개 가능한 값만 둡니다.

```text
허용: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_AI_TEST_MODE
금지: OpenAI API key, Supabase secret/service-role key
```

실제 `diary-ai` Function 서버 소스와 secret 설정은 이 저장소에 없습니다. 호환 Function을 연결할 때는 [API 명세](./api-specification.md)의 클라이언트 계약과 실제 서버 설정을 별도로 대조해야 합니다.

## 실행 모드 선택

### 로컬 필터까지 확인

`.env`를 만들지 않거나 다음처럼 둡니다.

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_AI_TEST_MODE=false
```

사진은 Canvas 연필 필터, 분석은 mock을 사용합니다.

### 이미지 처리 없이 UI만 확인

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_AI_TEST_MODE=true
```

사진은 원본, 분석은 mock을 사용합니다.

### 실제 분석만 확인

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
VITE_AI_TEST_MODE=true
```

사진은 원본을 사용하고 분석과 quota는 호환 Edge Function에 요청합니다. 서버 측 테스트 모드와 quota 우회 설정은 저장소 밖이므로 별도 확인이 필요합니다.

### 실제 그림 생성과 분석 확인

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
VITE_AI_TEST_MODE=false
```

그림과 분석을 모두 Edge Function에 요청합니다. 외부 비용과 서버 사용량 제한이 발생할 수 있으므로 의도한 환경에서만 사용합니다.

환경 변수를 바꾼 뒤에는 Vite를 재시작합니다.

## Apps in Toss 샌드박스 실행

```bash
npm run dev
```

이 명령은 `granite dev`를 실행합니다.

- Vite 개발 서버: `5173`
- 샌드박스 bridge: `8081`
- Vite bind: `0.0.0.0`
- 진입 deep link: `intoss://summer-vacation-diary`

샌드박스 앱에서 위 deep link를 엽니다. 콘솔에 같은 `appName`이 등록되어 있고 Toss 비즈니스 로그인이 가능한 환경이 필요합니다.

### Android 에뮬레이터

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:5173 tcp:5173
```

### iOS 시뮬레이터

시뮬레이터는 Mac의 localhost에 직접 접근할 수 있으므로 기본 host로 시도합니다.

### iOS·Android 실기기 또는 VPN

자동 선택한 LAN IP가 맞지 않으면 Mac의 실제 LAN IP를 지정합니다.

```bash
AIT_DEV_HOST=192.168.0.10 npm run dev
```

`192.168.0.10`은 예시입니다. Mac과 기기가 같은 네트워크에서 접근 가능한 실제 주소로 바꿉니다.

## 품질 확인

```bash
npm run lint
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
npm run build
```

`npx tsc`는 사용하지 않습니다. 저장소에 자동 테스트 framework와 `npm test` script는 없습니다. UI 변경은 [기능 명세의 수동 회귀 확인](./functional-specification.md#수동-회귀-확인)을 함께 수행합니다.

## 자주 확인할 실패 원인

| 증상                              | 확인할 항목                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| 항상 체험 모드                    | 두 `VITE_SUPABASE_*` 값이 모두 채워졌는지, Vite를 재시작했는지      |
| 그림 생성이 호출되지 않음         | `VITE_AI_TEST_MODE`가 `true`인지                                    |
| 샌드박스가 개발 서버를 찾지 못함  | 8081·5173 reverse 또는 `AIT_DEV_HOST`                               |
| 저장이 브라우저 다운로드로 동작   | Toss/샌드박스 운영 환경이 아니면 정상 fallback                      |
| 이전 일기가 시작 시 복원되지 않음 | 현재 `App.tsx`가 `restoreOnStart: false`로 의도적으로 새 draft 사용 |

## 관련 문서

- [API 명세](./api-specification.md)
- [배포](./deployment.md)
- [보안·데이터 처리](./security.md)
