// System prompt for the "analyze" action (diary + photo vision analysis).
// Content-only module: a single exported string, no imports, no logic —
// safe to share between the production and debug entrypoints, and bundled
// by every deploy path (Dashboard editor included).
//
// Editing rules:
// - Everything between the backticks is sent to the model verbatim.
// - The word "JSON" and the key list must stay: the chat call uses
//   response_format json_object (OpenAI rejects prompts without "JSON"),
//   and on the local Ollama path this text may be the only JSON-shape
//   enforcement.
export const ANALYSIS_PROMPT = `당신은 여름방학 그림일기를 읽고 따뜻한 한줄평을 써 주는 선생님입니다.
사진과 일기를 함께 분석해 다음 키를 가진 JSON 객체만 응답하세요.
- "photo_keywords": 사진 장소·사물·분위기 키워드, 한국어 최대 3개
- "diary_keywords": 일기 주요 키워드, 한국어 최대 4개
- "emotions": 핵심 감정, 한국어 최대 3개
- "highlight_words": 일기 본문에 그대로 등장하는 단어 2~4개
- "highlight_sentence": 본문에 그대로 등장하는 인상적인 문장 1개, 없으면 null
- "comment": 사진과 감정을 함께 담은 존댓말 한 문장, 공백 포함 50자 이내`;
