import { Paragraph } from "@toss/tds-mobile";

import { QUOTA_RESET_NOTICE } from "../constants/diary";
import { isRegionBlocked, useAiQuota } from "../hooks/useAiQuota";
import { isAiTestMode } from "../services/supabaseEdge";

function NoticeBox({
  lines,
  tone = "neutral",
}: {
  lines: string[];
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={`ai-quota-notice ai-quota-notice-${tone}`}
      aria-live="polite"
    >
      <span className="ai-quota-notice-symbol" aria-hidden="true">
        i
      </span>
      <div className="ai-quota-notice-copy">
        {lines.map((line) => (
          <Paragraph key={line} as="span" typography="t7" color="#5A442C">
            {line}
          </Paragraph>
        ))}
      </div>
    </div>
  );
}

function QuotaCounterNotice({
  label,
  used,
  limit,
  exhaustedMessage,
  recheckMessage,
}: {
  label: string;
  used: number;
  limit: number;
  exhaustedMessage: string;
  recheckMessage?: string;
}) {
  const remaining = Math.max(limit - used, 0);
  const available = remaining > 0;
  const safeLimit = Math.max(limit, 1);

  return (
    <div
      className={`ai-quota-notice ai-quota-counter${
        available ? "" : " is-exhausted"
      }`}
      aria-live="polite"
    >
      <div className="ai-quota-counter-header">
        <div className="ai-quota-counter-heading">
          <span className="ai-quota-counter-kicker">오늘의 {label}</span>
          <strong>
            {available ? `${remaining}회 남았어요` : exhaustedMessage}
          </strong>
        </div>

        <span
          className="ai-quota-counter-value"
          aria-label={`${limit}회 중 ${remaining}회 남음`}
        >
          <strong>{remaining}</strong>
          <span>/{limit}</span>
        </span>
      </div>

      <div
        className="ai-quota-meter"
        role="progressbar"
        aria-label={`${label} 남은 횟수`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={remaining}
      >
        {Array.from({ length: safeLimit }, (_, index) => (
          <span
            key={index}
            className={index < remaining ? "is-remaining" : ""}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="ai-quota-counter-footer">
        <span>{available ? `하루 최대 ${limit}회` : QUOTA_RESET_NOTICE}</span>
        {available && recheckMessage !== undefined && (
          <strong>{recheckMessage}</strong>
        )}
      </div>
    </div>
  );
}

interface QuotaNoticeCopy {
  label: string;
  localTest: string[];
  serverTest: string[];
  regionBlocked: string[];
  checking: string;
  exhausted: string;
  recheck: string;
}

const QUOTA_NOTICE_COPY: QuotaNoticeCopy = {
  label: "AI 검사",
  localTest: ["테스트 모드 · AI 검사를 제한 없이 이용할 수 있어요."],
  serverTest: ["테스트 모드 · AI 검사를 제한 없이 이용할 수 있어요."],
  regionBlocked: [
    "해외에서는 AI 그림일기 검사를 이용할 수 없어요.",
    "AI 결과 없이도 그림일기를 완성할 수 있어요.",
  ],
  checking: "오늘의 AI 검사 기회를 확인하고 있어요.",
  exhausted: "오늘 기회를 모두 사용했어요",
  recheck: "다시 검사하면 1회 사용",
};

function QuotaNotice({ showRecheckNotice }: { showRecheckNotice: boolean }) {
  const quota = useAiQuota();
  const copy = QUOTA_NOTICE_COPY;

  if (isAiTestMode) {
    return <NoticeBox lines={copy.localTest} />;
  }
  if (isRegionBlocked(quota)) {
    return <NoticeBox lines={copy.regionBlocked} tone="warning" />;
  }
  if (quota.mode === "ready" && quota.testMode) {
    return <NoticeBox lines={copy.serverTest} />;
  }
  if (quota.mode !== "ready") {
    return quota.mode === "unknown" ? (
      <NoticeBox lines={[copy.checking]} />
    ) : null;
  }

  const { used, limit } = quota.completion;

  return (
    <QuotaCounterNotice
      label={copy.label}
      used={used}
      limit={limit}
      exhaustedMessage={copy.exhausted}
      recheckMessage={showRecheckNotice ? copy.recheck : undefined}
    />
  );
}

export function AiQuotaNotice({
  showRecheckNotice = false,
}: {
  showRecheckNotice?: boolean;
}) {
  return <QuotaNotice showRecheckNotice={showRecheckNotice} />;
}
