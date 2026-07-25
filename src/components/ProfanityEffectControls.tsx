import type { DiaryDraft } from "../hooks/useDiaryDraft";

type ProfanityEffectKey =
  | "profanityMosaicEnabled"
  | "profanityUnderlineEnabled"
  | "profanityTeacherNoteEnabled";

const EFFECT_OPTIONS: ReadonlyArray<{
  key: ProfanityEffectKey;
  label: string;
}> = [
  { key: "profanityMosaicEnabled", label: "모자이크" },
  { key: "profanityUnderlineEnabled", label: "빨간줄" },
  { key: "profanityTeacherNoteEnabled", label: "선생님 문구" },
];

interface ProfanityEffectControlsProps {
  draft: DiaryDraft;
  onChange: (patch: Partial<DiaryDraft>) => void;
  className?: string;
}

export function ProfanityEffectControls({
  draft,
  onChange,
  className,
}: ProfanityEffectControlsProps) {
  return (
    <fieldset
      className={`profanity-correction-options${className ? ` ${className}` : ""}`}
    >
      <legend>욕설 처리 방법</legend>
      {EFFECT_OPTIONS.map((option) => (
        <label key={option.key} className="profanity-correction-option">
          <input
            type="checkbox"
            checked={draft[option.key]}
            onChange={(event) =>
              onChange({ [option.key]: event.target.checked })
            }
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
