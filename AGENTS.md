# AGENTS.md

## 프로젝트 개요

Apps in Toss WebView에서 실행되는 여름방학 그림일기 미니앱입니다. React 18, TypeScript, Vite, Apps in Toss Web Framework 2.x와 TDS Mobile을 사용합니다.

## 주요 명령

```bash
npm install
npm run dev
npm run dev:web
npm run build
npm run lint
npm run format
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
```

`npx tsc`는 사용하지 않습니다. 테스트 프레임워크는 없습니다.

## 구조

- `src/App.tsx`: `upload → write → preview` 단일 화면 흐름
- `src/components/`: 업로드·작성·미리보기 UI
- `src/hooks/`: 초안 저장, 그림 변환, 분석 상태
- `src/services/`: Supabase Edge Function 호출, mock, 저장·공유
- `src/utils/`: 이미지 처리와 Canvas 합성
- `granite.config.ts`: Apps in Toss 앱 설정
- `docs/`: 현재 코드와 운영 흐름을 설명하는 문서

## 동작 원칙

- 앱 이름은 `summer-vacation-diary`를 유지하고 표시 이름은 `나의 여름방학 일기`를 사용합니다.
- Supabase 환경변수가 없으면 로컬 mock·필터로 체험할 수 있습니다.
- Supabase 환경변수가 있으면 배포된 `diary-ai` Edge Function을 사용합니다. 서버 원본은 이 저장소에 보관하지 않습니다.
- 사진과 일기는 동의 모달을 거친 뒤에만 외부 분석 경로로 전송합니다.
- 변경 후 `lint`, 로컬 TypeScript 검사, `build`를 실행합니다.
