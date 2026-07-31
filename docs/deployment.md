# 배포

[README로 돌아가기](../README.md) · [개발 환경 설정](./setup.md) · [아키텍처](./architecture.md)

## 배포 대상

실행 앱은 Apps in Toss WebView track용 React 웹 번들입니다.

| 설정          | 값                        | 근거                                   |
| ------------- | ------------------------- | -------------------------------------- |
| appName       | `summer-vacation-diary`   | `granite.config.ts`                    |
| 표시 이름     | `나의 여름방학 일기`      | `src/constants/brand.ts`               |
| build command | `vite build`              | `granite.config.ts#web.commands.build` |
| output        | `dist`                    | `granite.config.ts#outdir`             |
| SDK command   | `ait build`, `ait deploy` | `package.json`                         |
| 앱 권한       | 빈 배열                   | `granite.config.ts#permissions`        |

앱 아이콘은 코드의 `brand.icon`이 아니라 Apps in Toss 콘솔 업로드로 관리하도록 설정 주석에 기록되어 있습니다.

## 배포 전 검증

```bash
npm ci
npm run lint
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
npm run build
```

성공하면 `dist/`와 `.ait` 산출물이 생성됩니다. 둘 다 `.gitignore` 대상이며 Git에 커밋하지 않습니다.

자동 테스트가 없으므로 [수동 회귀 확인](./functional-specification.md#수동-회귀-확인)을 별도로 수행합니다.

## Apps in Toss 배포

```bash
npm run deploy
```

이 명령은 `ait deploy`를 실행합니다. 다음 외부 조건이 필요합니다.

- Apps in Toss 콘솔에 `summer-vacation-diary` 등록
- 콘솔 표시 이름 `나의 여름방학 일기`
- 배포 권한과 콘솔 API key
- 콘솔에 업로드한 앱 아이콘

이 저장소에는 콘솔 credential을 저장하지 않습니다.

## 외부 기능 배포

클라이언트는 `{VITE_SUPABASE_URL}/functions/v1/diary-ai`를 호출합니다. 2026-07-31에 `index.ts` 스냅샷이 별도로 제공되었지만 다음 서버 산출물은 저장소에서 version 관리되지 않습니다.

- Edge Function source와 import 대상 `prompt_analysis.ts`, `prompt_sketch.ts`
- Supabase 사용량 테이블의 versioned migration 파일
- 세 quota RPC의 SQL 원문
- 서버 secret과 운영 배포 설정

제공된 table metadata, 재현용 DDL과 설치된 RPC를 복구하는 SQL은 [ERD](./erd.md)에 문서화했습니다. 프론트엔드 배포만으로 실제 그림 생성·분석과 사용량 강제가 활성화되지는 않습니다. 호환 Function, prompt, 테이블과 세 RPC를 별도 배포한 뒤 공개 URL과 publishable key만 프론트엔드 build 환경에 주입해야 합니다.

제공된 스냅샷의 요청·응답, quota 값과 한국 지역 정책은 [API 명세](./api-specification.md)를 따릅니다. 운영 배포 version과 보존 기간은 실제 서버에서 확인해야 합니다.

## 환경별 권장 확인

| 환경           | 확인 항목                                                               |
| -------------- | ----------------------------------------------------------------------- |
| 브라우저       | mock/필터, JPEG 다운로드, Web Share·링크 복사, localStorage 달력        |
| Toss 샌드박스  | deep link, safe area, `saveBase64Data`, Toss 공유창, `Storage` 달력     |
| iOS 실기기     | 세로·가로 사진의 cover 자르기·회전, 저장 화면, 보관 일기 열람·공유·삭제 |
| Android 실기기 | 빈 MIME, 저장 파일명, back 동작, 달력 스와이프                          |
| 실제 Supabase  | analyze·sketch·quota-status contract, timeout, 오류 code                |

## 출시 전 체크리스트

- [ ] 앱 이름에 금지된 단어가 포함되지 않고 `appName`이 `summer-vacation-diary`다.
- [ ] 콘솔 표시 이름과 `BRAND_DISPLAY_NAME`이 `나의 여름방학 일기`로 일치한다.
- [ ] 콘솔 아이콘이 현재 앱 아이콘과 일치한다.
- [ ] `VITE_*` bundle에 비밀값이 없다.
- [ ] 처리 동의 문구가 실제 외부 전송·보존 정책과 일치한다.
- [ ] 한국·해외 IP의 실제 지역 제한 동작을 확인했다.
- [ ] 사용량 제한과 09:00 KST reset 안내가 실제 서버와 일치한다.
- [ ] iOS·Android에서 저장·공유를 실기기로 확인했다.
- [ ] 완성 JPEG가 일기 달력에 자동 보관되고 앱 재실행 후에도 열리는지 확인했다.
- [ ] 날짜별 3개 제한, 같은 사진·본문의 날짜 변경 시 기존 기록 교체, 사진 또는 본문 수정 시 별도 기록 유지, 삭제 확인과 저장소 부족 오류를 확인했다.
- [ ] 보관 기록이 계정·기기·브라우저 환경 사이에 동기화되지 않는다는 제품 안내가 운영 정책과 맞다.
- [ ] Edge Function 장애 시 원본 사진과 mock이 아니라 명시적 오류/fallback이 나타난다.
- [ ] 린트, 타입 검사, build가 성공했다.

## CI/CD 상태

`.github/workflows/discord-merge-notification.yml`은 `main` 대상 PR merge 후 Discord 알림만 전송합니다. build, lint, typecheck, test, deploy 자동화는 없습니다.

자동 배포를 수행한다고 문서화할 근거가 없으므로 배포는 현재 수동 명령으로만 명세합니다.

## rollback과 운영

저장소에는 release tag 정책, rollback script, 이전 `.ait` 보관 정책이 없습니다. Apps in Toss 콘솔의 실제 rollback 지원과 운영 절차는 `확인 필요`입니다.

## 관련 문서

- [개발 환경 설정](./setup.md)
- [API 명세](./api-specification.md)
- [ERD](./erd.md)
- [보안·데이터 처리](./security.md)
