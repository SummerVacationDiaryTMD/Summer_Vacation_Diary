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

export function SketchQuotaNotice({
  showRecheckNotice = false,
}: {
  showRecheckNotice?: boolean;
}) {
  const quota = useAiQuota();

  // 처음 사진을 고르는 동안에는 횟수 안내를 숨기고, 미리보기를 본 뒤
  // 다시 사진을 바꾸러 온 경우에만 재생성 안내를 보여줍니다.
  if (!showRecheckNotice) {
    return null;
  }

  if (isAiTestMode) {
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

  if (quota.mode === "ready" && quota.testMode) {
    return (
      <NoticeBox
        lines={["테스트 모드 · 그림 그리기: 횟수 제한 없이 이용할 수 있어요."]}
      />
    );
  }

  if (quota.mode !== "ready") {
    if (quota.mode === "unknown") {
      return (
        <NoticeBox lines={["오늘의 그림 그리기 기회를 확인하고 있어요."]} />
      );
    }
    return null;
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
        `사진을 바꿔 다시 그리면 1회 차감돼요.`,
        `하루에 ${limit}번까지 그림을 그릴 수 있어요.`,
        `오늘 그림 그리기: ${used}/${limit}`,
      ]}
    />
  );
}

export function AnalyzeQuotaNotice({
  showRecheckNotice = false,
}: {
  showRecheckNotice?: boolean;
}) {
  const quota = useAiQuota();

  // 처음 일기를 쓰는 동안에는 검사 기회 안내를 숨기고, 미리보기를 본
  // 뒤 다시 수정하러 온 경우에만 재검사 안내를 보여줍니다.
  if (!showRecheckNotice) {
    return null;
  }

  if (isAiTestMode) {
    return (
      <NoticeBox
        lines={["테스트 모드 · 일기 검사: 횟수 제한 없이 이용할 수 있어요."]}
      />
    );
  }

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

  if (quota.mode === "ready" && quota.testMode) {
    return (
      <NoticeBox
        lines={["테스트 모드 · 일기 검사: 횟수 제한 없이 이용할 수 있어요."]}
      />
    );
  }

  if (quota.mode !== "ready") {
    if (quota.mode === "unknown") {
      return <NoticeBox lines={["오늘의 일기 검사 기회를 확인하고 있어요."]} />;
    }
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
        `수정 후 다시 검사받으면 1회 차감돼요.`,
      ]}
    />
  );
}
