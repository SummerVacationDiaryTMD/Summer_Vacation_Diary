# 나의 여름방학일기

Apps in Toss 바이브코딩 챌린지를 위한 여름방학 그림일기 미니앱입니다.

## 시작하기

```bash
npm install
npm run dev
```

OpenAI API 키가 없어도 로컬 체험 모드로 전체 흐름을 실행할 수 있습니다.

## 환경 변수 (선택)

저장소 루트에 `.env` 파일을 만들고 필요한 값을 설정합니다.

```bash
VITE_OPENAI_API_KEY=sk-...
VITE_OPENAI_MODEL=gpt-4o-mini
VITE_OPENAI_IMAGE_MODEL=gpt-image-1
VITE_OPENAI_IMAGE_QUALITY=
```

> Vite의 `VITE_*` 값은 클라이언트 번들에 포함됩니다. 공개 배포 전에는
> OpenAI 호출을 백엔드 프록시로 옮겨야 합니다.

## 확인 및 배포

```bash
npm run lint
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
npm run build
npm run deploy
```

- [Apps in Toss 콘솔](https://apps-in-toss.toss.im/)
- [Apps in Toss 개발자센터](https://developers-apps-in-toss.toss.im/)
- [Apps in Toss 개발자 커뮤니티](https://techchat-apps-in-toss.toss.im/)
