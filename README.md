# 나의 여름방학일기

Apps in Toss 바이브코딩 챌린지를 위한 여름방학 그림일기 미니앱입니다.

사진 전송 동의 안내, Supabase Edge Function의 기기·IP 사용량 제한, 완성 이미지
저장과 앱 링크·기기 공유 기능을 포함합니다.

## 시작하기

```bash
npm install
npm run dev
```

Supabase 연결 설정이 없어도 로컬 체험 모드로 전체 흐름을 실행할 수 있습니다.

## 환경 변수 (선택)

저장소 루트의 `.env.example`을 `.env`로 복사한 뒤 Supabase 공개 설정을 입력합니다.

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`OPENAI_API_KEY`는 앱 `.env`가 아니라 Supabase Edge Function Secret에만
저장합니다. Edge Function 생성·Secret 등록·배포 방법은
[`SUPABASE_EDGE_FUNCTION.md`](./SUPABASE_EDGE_FUNCTION.md)를 참고하세요.

완성 화면의 카카오톡·인스타그램 공유는 운영체제 공유창을 사용합니다. 실제로
표시되는 앱은 기기의 설치 상태와 WebView 지원 여부에 따라 달라지며, 지원되지
않는 환경에서는 링크 복사 또는 이미지 저장으로 대체됩니다.

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
