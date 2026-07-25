import { Paragraph } from "@toss/tds-mobile";

import { QUOTA_RESET_NOTICE } from "../constants/diary";
import { isRegionBlocked, useAiQuota } from "../hooks/useAiQuota";
import { isAiTestMode } from "../services/supabaseEdge";

/**
 * The two AI budgets, told to the user in the screen where they are about to be
 * spent. Each notice reads the store directly rather than taking props, because
 * the value it needs never belongs to its parent's state.
 *
 * These numbers are informational. Enforcement is the server's atomic consume,
 * so a stale or edited counter here changes nothing about what is allowed.
 */
function NoticeBox({ lines }: { lines: string[] }) {
  return (
    <div className="ai-quota-notice">
      {lines.map((line) => (
        <Paragraph key={line} as="span" typography="t7" color="#6b5e3f">
          {line}
        </Paragraph>
      ))}
    </div>
  );
}

export function SketchQuotaNotice() {
  const quota = useAiQuota();

  if (isAiTestMode && quota.mode !== "hidden") {
    return (
      <NoticeBox
        lines={[
          "테스트 모드에서는 원본 사진으로 그림일기를 미리 볼 수 있어요.",
        ]}
      />
    );
  }

  if (isRegionBlocked(quota)) {
    return (
      <NoticeBox
        lines={[
          "해외에서는 AI친구가 그림을 그려줄 수 없어요.",
          "원본 사진으로 그림일기를 완성할 수 있어요.",
        ]}
      />
    );
  }

  if (quota.mode !== "ready") {
    return (
      <NoticeBox lines={["다음 단계에서 AI친구가 색연필 그림을 그려줘요 ✏️"]} />
    );
  }

  const { used, limit, available } = quota.sketch;
  if (!available) {
    return (
      <NoticeBox
        lines={[
          "오늘의 그림 그리기 기회를 모두 사용했어요.",
          QUOTA_RESET_NOTICE,
        ]}
      />
    );
  }

  return (
    <NoticeBox
      lines={[
        "'일기 쓰러 가기'를 누르면 AI친구가 그림을 그려줘요.",
        `하루에 ${limit}번까지 그림을 그릴 수 있어요.`,
        `오늘 그림 그리기: ${used}/${limit}`,
      ]}
    />
  );
}

export function AnalyzeQuotaNotice() {
  const quota = useAiQuota();

  if (isRegionBlocked(quota)) {
    return (
      <NoticeBox
        lines={[
          "해외에서는 선생님이 일기를 검사해 줄 수 없어요.",
          "선생님 한마디 없이도 그림일기를 완성할 수 있어요.",
        ]}
      />
    );
  }

  if (quota.mode !== "ready") {
    return null;
  }

  const { used, limit, available } = quota.analyze;
  if (!available) {
    return (
      <NoticeBox
        lines={["오늘의 일기 검사 기회를 모두 사용했어요.", QUOTA_RESET_NOTICE]}
      />
    );
  }

  return (
    <NoticeBox
      lines={[
        `선생님은 하루에 ${limit}번까지 일기를 검사해 줘요.`,
        `오늘 일기 검사: ${used}/${limit}`,
        "다시 검사받으면 검사 기회가 1번 더 사용돼요.",
      ]}
    />
  );
}
