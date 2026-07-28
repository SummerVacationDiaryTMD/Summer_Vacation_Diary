# 코드 중복 리팩토링 현황

이 문서는 리팩토링의 대상과 판단 근거를 기록합니다. 리팩토링은 화면과 기능을 바꾸지 않고, 함께 변경되는 코드를 한곳으로 모으는 것을 원칙으로 합니다.

## 완료

- [x] AI 사용량 안내 공통화 (`main` 반영)
  - 대상: `src/components/AiQuotaNotice.tsx`
  - 변경: `SketchQuotaNotice`, `AnalyzeQuotaNotice`의 동일한 quota 상태 분기를 `QuotaNotice`로 통합했습니다.
  - 유지: 종류별 quota 값과 모든 안내 문구는 `sketch`·`analyze` 설정으로 분리해 기존 동작을 유지합니다.
  - 확인: lint, TypeScript 검사, production build를 실행합니다.

- [x] 단계별 하단 버튼 공통화 (`main` 반영)
  - 대상: `src/components/DiaryButton.tsx`
  - 변경: 반복되던 버튼 클래스와 TDS 옵션 조합을 `DiaryButton`으로 통합했습니다.

- [x] 첨삭 마크 이미지 선택 공통화
  - 대상: `src/utils/positionedAsset.ts`, `src/utils/*Marks.ts`
  - 변경: 별·검사·첨삭 마크가 공통으로 사용하던 좌표 기반 선택 공식을 `pickPositionedAsset`으로 추출했습니다.
  - 유지: 각 마크의 자산 목록과 기존 공개 함수는 그대로 유지해 미리보기와 Canvas 결과가 바뀌지 않습니다.

- [x] 재확인 안내 상태 통합
  - 대상: `src/App.tsx`
  - 변경: 그림 다시 그리기와 일기 다시 검사 안내에 쓰이던 두 boolean state를 액션별 상태 객체와 공통 setter로 통합했습니다.
  - 유지: 각 화면 컴포넌트에는 기존과 같은 boolean prop을 전달합니다.

- [x] 이미지 디코딩과 크기 검증 공통화
  - 대상: `src/utils/image.ts`
  - 변경: 파일 처리·크롭 원본 로드·data URL 로드가 공유하던 이미지 생성과 성공·실패 처리를 `loadImageFromSource`로 통합했습니다.
  - 유지: 업로드 이미지 최소 크기 검증, 오류 코드, object URL 해제와 크롭 원본 보존은 기존과 동일합니다.

## 보류

- 현재 확인된 대상은 모두 완료했습니다. 새 화면·마크 종류가 추가될 때 다시 점검합니다.

## 완료 기준

- 기존 화면의 문구와 표시 조건이 동일하다.
- 호출하는 컴포넌트의 공개 API가 유지된다.
- `npm run lint`, `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json`, `npm run build`가 통과한다.
