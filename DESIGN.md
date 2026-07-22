# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-22
- Primary product surfaces: 사진 업로드, 일기 작성, 미리보기 및 저장 이미지
- Evidence reviewed: `src/components/PreviewStep.tsx`, `src/components/WriteStep.tsx`, `src/App.css`, `src/utils/diaryImage.ts`, `public/picture-diary-frame.png`

## Brand
- Personality: 따뜻하고 친근한 어린이 방학 그림일기
- Trust signals: 사용자가 입력한 사진과 글이 미리보기와 저장 결과에서 동일하게 보임
- Avoid: 원본 일기장 프레임의 세로 왜곡, 과도한 장식, 작은 본문 글씨

## Product goals
- Goals: 사진과 손글씨 일기를 한 장의 추억 이미지로 쉽게 완성하고 저장
- Non-goals: 범용 문서 편집기나 무제한 장문 작성 도구
- Success signals: 5~9행 일기에서 프레임, 주석, 코멘트가 겹치지 않고 저장 결과와 일치

## Personas and jobs
- Primary personas: 초등학생과 가족
- User jobs: 방학의 하루를 사진과 짧은 글로 기록하고 공유 가능한 이미지로 보관
- Key contexts of use: Toss 모바일 WebView, 작은 화면, 터치 입력

## Information architecture
- Primary navigation: 업로드 → 작성 → 미리보기
- Core routes/screens: 단일 상태 기반 3단계 화면
- Content hierarchy: 날짜/날씨 → 제목 → 사진 → 원고지 본문 → 선생님 한줄평

## Design principles
- 원본 프레임의 비율과 질감을 늘리거나 찌그러뜨리지 않는다.
- 미리보기와 저장 이미지는 하나의 레이아웃 계산 결과를 공유한다.
- 본문은 11칸 원고지 행 단위로만 확장한다.
- Tradeoffs: 긴 글을 위해 글자를 축소하지 않고 전체 카드 높이를 늘린다.

## Visual language
- Color: 아이보리 종이, 옅은 갈색 테두리, 연필색 본문, 붉은 교정 표시
- Typography: `NanumCoDingHeuiMang` 손글씨체와 시스템 한글 폰트
- Spacing/layout rhythm: 원본 1058px 프레임 좌표와 69px 원고지 행을 기준으로 계산
- Shape/radius/elevation: 원본 프레임의 둥근 하단과 얕은 그림자 유지
- Motion: 필수 상태 전환 외 장식적 모션 최소화
- Imagery/iconography: 사용자의 사진 또는 색연필 변환 이미지가 주 시각 요소

## Components
- Existing components to reuse: `PreviewStep`, 원고지 하이라이트, Canvas 저장 합성
- New/changed components: `DiaryFrameBackground`, `DiaryFrameLayout`
- Variants and states: 기본 5행, 가변 6~9행, 분석 로딩/오류/성공
- Token/component ownership: 프레임 좌표와 행 제한은 `src/utils/diaryFrameLayout.ts`가 소유

## Accessibility
- Target standard: 기존 TDS 접근성 규칙 유지
- Keyboard/focus behavior: 프레임 배경은 포커스와 읽기 순서에서 제외
- Contrast/readability: 글자 크기를 줄이는 대신 카드 높이를 확장
- Screen-reader semantics: 장식 프레임과 교정 오버레이는 `aria-hidden`
- Reduced motion and sensory considerations: 가변 프레임에 별도 모션 없음

## Responsive behavior
- Supported breakpoints/devices: Toss 모바일 WebView와 일반 모바일 브라우저
- Layout adaptations: 너비는 컨테이너에 맞추고 높이는 계산된 프레임 비율로 결정
- Touch/hover differences: 핵심 조작은 터치 대상으로 유지하며 hover에 의존하지 않음

## Interaction states
- Loading: 사진 영역과 한줄평 영역에서 기존 로더 유지
- Empty: 사진 미선택 상태 표시
- Error: 변환 및 분석 재시도 제공
- Success: 가변 프레임 안에 분석 주석과 태그 표시
- Disabled: 작성 조건을 충족하기 전 다음 단계 버튼 비활성화
- Offline/slow network: 체험 모드와 기존 오류 상태 유지

## Content voice
- Tone: 어린이에게 친근하고 격려하는 한국어
- Terminology: 그림일기, 선생님 한줄평, 원본 사진, 그림
- Microcopy rules: 짧고 직접적이며 실패 시 다음 행동을 명시

## Implementation constraints
- Framework/styling system: React 18, TypeScript, Vite, TDS Mobile, CSS
- Design-token constraints: 기존 프레임 색과 좌표를 우선하며 새 디자인 시스템을 추가하지 않음
- Performance constraints: 프레임 원본 한 장을 재사용하고 새 대형 이미지 자산을 추가하지 않음
- Compatibility constraints: DOM 미리보기와 Canvas 저장이 동일한 픽셀 레이아웃을 사용
- Test/screenshot expectations: 타입검사, 린트, 빌드 후 5행과 9행 시각 확인

## Open questions
- [ ] 9행을 넘는 일기를 다음 장으로 나눌지 제품 정책 확정
