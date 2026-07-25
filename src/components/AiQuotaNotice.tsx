import { Paragraph } from "@toss/tds-mobile";

import { QUOTA_RESET_NOTICE } from "../constants/diary";
import { useAiQuota } from "../hooks/useAiQuota";
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

  // Test mode returns the original photo without ever calling the server, so a
  // counter would be meaningless — and the standard copy would promise a
  // drawing that never arrives.
  if (isAiTestMode && quota.mode !== "hidden") {
    return (
      <NoticeBox
        lines={[
          "테스트 모드에서는 그림을 그리지 않고 원본 사진을 그대로 사용해요.",
        ]}
      />
    );
  }

  // Mock mode draws locally with no budget at all, and an unknown budget must
  // never be rendered as a number. Both fall back to the original guidance.
  if (quota.mode !== "ready") {
    return (
      <NoticeBox
        lines={["다음 단계로 가면 사진이 색연필 그림으로 바뀌어요 ✏️"]}
      />
    );
  }

  const { used, limit, available } = quota.sketch;
  if (!available) {
    return (
      <NoticeBox
        lines={[
          `오늘의 그림 그리기 횟수를 모두 사용했어요.`,
          `${QUOTA_RESET_NOTICE}`,
        ]}
      />
    );
  }

  return (
    <NoticeBox
      lines={[
        "'일기 쓰러 가기' 버튼을 누르면 AI친구가 그림을 그리기 시작해요.",
        `그림은 하루에 총 ${limit}번만 그려주니, 신중히 선택해 주세요.`,
        `오늘 친구가 그려준 횟수: ${used}/${limit}`,
      ]}
    />
  );
}

export function AnalyzeQuotaNotice() {
  const quota = useAiQuota();

  // No server budget to report in mock mode, and nothing trustworthy to say
  // before the first snapshot lands.
  if (quota.mode !== "ready") {
    return null;
  }

  const { used, limit, available } = quota.analyze;
  if (!available) {
    return (
      <NoticeBox
        lines={[
          `오늘의 일기 검사 횟수를 모두 사용했어요.`,
          `${QUOTA_RESET_NOTICE}`,
        ]}
      />
    );
  }

  return (
    <NoticeBox
      lines={[
        `선생님은 하루에 ${limit}번만 일기를 검사해 줘요.`,
        `오늘 일기 검사 횟수: ${used}/${limit}`,
        // Editing changes the input signature, which makes the next check a new
        // request. Saying so up front is cheaper than a confirmation dialog on
        // every press.
        "일기를 고친 뒤 다시 검사받으면 횟수가 한 번 더 줄어들어요.",
      ]}
    />
  );
}
