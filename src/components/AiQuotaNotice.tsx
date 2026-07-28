import { Paragraph } from "@toss/tds-mobile";

import { QUOTA_RESET_NOTICE } from "../constants/diary";
import { isRegionBlocked, useAiQuota } from "../hooks/useAiQuota";
import { isAiTestMode } from "../services/supabaseEdge";

function NoticeBox({ lines }: { lines: string[] }) {
  return (
    <div className="ai-quota-notice">
      {lines.map((line) => (
        <Paragraph key={line} as="span" typography="t7" color="#5A442C">
          {line}
        </Paragraph>
      ))}
    </div>
  );
}

type QuotaAction = "sketch" | "analyze";

interface QuotaNoticeCopy {
  localTest: string[];
  serverTest: string[];
  regionBlocked: string[];
  checking: string;
  exhausted: string;
  recheck: string;
  available: (used: number, limit: number) => string[];
}

const QUOTA_NOTICE_COPY: Record<QuotaAction, QuotaNoticeCopy> = {
  sketch: {
    localTest: [
      "테스트 모드에서는 원본 사진으로 그림일기를 미리 볼 수 있어요.",
    ],
    serverTest: ["테스트 모드 · 그림 그리기: 횟수 제한 없이 이용할 수 있어요."],
    regionBlocked: [
      "해외에서는 AI친구가 그림을 그려줄 수 없어요.",
      "원본 사진으로 그림일기를 완성할 수 있어요.",
    ],
    checking: "오늘의 그림 그리기 기회를 확인하고 있어요.",
    exhausted: "오늘의 그림 그리기 기회를 모두 사용했어요.",
    recheck: "사진을 바꿔 다시 그리면 1회 차감돼요.",
    available: (used, limit) => [
      `하루에 ${limit}번까지 그림을 그릴 수 있어요.`,
      `오늘 그림 그리기: ${used}/${limit}`,
    ],
  },
  analyze: {
    localTest: ["테스트 모드 · 일기 검사: 횟수 제한 없이 이용할 수 있어요."],
    serverTest: ["테스트 모드 · 일기 검사: 횟수 제한 없이 이용할 수 있어요."],
    regionBlocked: [
      "해외에서는 선생님이 일기를 검사해 줄 수 없어요.",
      "선생님 한마디 없이도 그림일기를 완성할 수 있어요.",
    ],
    checking: "오늘의 일기 검사 기회를 확인하고 있어요.",
    exhausted: "오늘의 일기 검사 기회를 모두 사용했어요.",
    recheck: "수정 후 다시 검사받으면 1회 차감돼요.",
    available: (used, limit) => [
      `선생님은 하루에 ${limit}번까지 일기를 검사해 줘요.`,
      `오늘 일기 검사: ${used}/${limit}`,
    ],
  },
};

function QuotaNotice({
  action,
  showRecheckNotice,
}: {
  action: QuotaAction;
  showRecheckNotice: boolean;
}) {
  const quota = useAiQuota();
  const copy = QUOTA_NOTICE_COPY[action];

  if (isAiTestMode) {
    return <NoticeBox lines={copy.localTest} />;
  }
  if (isRegionBlocked(quota)) {
    return <NoticeBox lines={copy.regionBlocked} />;
  }
  if (quota.mode === "ready" && quota.testMode) {
    return <NoticeBox lines={copy.serverTest} />;
  }
  if (quota.mode !== "ready") {
    return quota.mode === "unknown" ? (
      <NoticeBox lines={[copy.checking]} />
    ) : null;
  }

  const { used, limit, available } = quota[action];
  const lines = available
    ? [
        ...copy.available(used, limit),
        ...(showRecheckNotice ? [copy.recheck] : []),
      ]
    : [copy.exhausted, QUOTA_RESET_NOTICE];

  return <NoticeBox lines={lines} />;
}

export function SketchQuotaNotice({
  showRecheckNotice = false,
}: {
  showRecheckNotice?: boolean;
}) {
  return <QuotaNotice action="sketch" showRecheckNotice={showRecheckNotice} />;
}

export function AnalyzeQuotaNotice({
  showRecheckNotice = false,
}: {
  showRecheckNotice?: boolean;
}) {
  return <QuotaNotice action="analyze" showRecheckNotice={showRecheckNotice} />;
}
