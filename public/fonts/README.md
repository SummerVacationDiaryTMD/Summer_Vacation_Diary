# 그림일기 손글씨 폰트

현재 미리보기와 저장 이미지에 `NanumCoDingHeuiMang` 폰트를 사용합니다.

```text
public/fonts/NanumCoDingHeuiMang.ttf
```

## 적용 위치

- CSS 등록과 미리보기: `src/App.css`
- Canvas 저장 이미지: `src/utils/diaryImage.ts`
- 글자별 크기·회전·위치 변형: `src/utils/handwriting.ts`

`handwritingVariation()`은 글자와 위치를 기준으로 결과를 고정하므로,
다시 렌더링해도 글자가 움직이지 않습니다. 미리보기와 저장 이미지는 같은
변형 강도 `1`을 사용합니다.

## 폰트 교체

1. 새 TTF 파일을 `public/fonts/`에 넣습니다.
2. `src/App.css`의 `@font-face` 경로와 `font-family`를 바꿉니다.
3. `src/utils/diaryImage.ts`의 `DIARY_FONT_FAMILY`를 같은 이름으로 바꿉니다.
4. 개발 서버를 재시작하고 미리보기와 저장 이미지를 모두 확인합니다.
