import type { DiaryProgressView } from "../hooks/useDiaryProgress";

const MASCOT_IDLE_URL = "/mascot/stamp-friend-idle.png";
const MASCOT_COMPLETE_URL = "/mascot/stamp-friend-complete.png";

function streakCopy(progress: DiaryProgressView): {
  title: string;
  description: string;
} {
  const snapshot = progress.snapshot;
  if (progress.status === "error" && snapshot === null) {
    return {
      title: "연속 기록을 확인하지 못했어요",
      description: "일기 작성은 그대로 할 수 있어요. 오늘 다시 들어오면 확인할게요.",
    };
  }
  if (snapshot === null) {
    return {
      title: "오늘의 일기 도장을 준비하고 있어요",
      description: "잠시만 기다려 주세요.",
    };
  }
  if (snapshot.completedToday) {
    return {
      title: `오늘의 도장 완료 · 연속 ${snapshot.currentStreak}일`,
      description: "오늘도 만나서 반가워요! 도장은 잘 붙어 있어요.",
    };
  }
  if (snapshot.daysAway !== null && snapshot.daysAway >= 7) {
    return {
      title: "오랜만이에요! 돌아와 줘서 반가워요",
      description: "오늘의 장면부터 천천히 다시 남겨볼까요?",
    };
  }
  if (snapshot.daysAway !== null && snapshot.daysAway >= 3) {
    return {
      title: "한동안 안 보여서 궁금했어요",
      description: "오늘 일기를 완성하면 새로운 기록이 시작돼요.",
    };
  }
  if (snapshot.currentStreak > 0) {
    return {
      title: `연속 ${snapshot.currentStreak}일째`,
      description: `오늘 일기를 완성하면 ${snapshot.currentStreak + 1}일째예요.`,
    };
  }
  if (snapshot.totalActivityDays > 0) {
    return {
      title: "오늘은 다시 시작하는 날",
      description: `지금까지 기록한 ${snapshot.totalActivityDays}일은 그대로예요.`,
    };
  }
  return {
    title: "오늘 첫 일기 도장을 찍어볼까요?",
    description: "일기 한 편을 완성하면 1일째가 시작돼요.",
  };
}

export function DiaryStreakLead({
  progress,
}: {
  progress: DiaryProgressView;
}) {
  const copy = streakCopy(progress);
  const completed = progress.snapshot?.completedToday === true;
  return (
    <div className="diary-streak-lead">
      <img
        className={`diary-streak-mascot${completed ? " is-complete" : ""}`}
        src={completed ? MASCOT_COMPLETE_URL : MASCOT_IDLE_URL}
        alt="일기 도장 친구"
        draggable={false}
      />
      <div className="diary-streak-copy">
        <strong>{copy.title}</strong>
        <span>{copy.description}</span>
      </div>
    </div>
  );
}

export function DiaryStreakCalendarCard({
  progress,
}: {
  progress: DiaryProgressView;
}) {
  const snapshot = progress.snapshot;
  const completed = snapshot?.completedToday === true;

  return (
    <section className="diary-streak-calendar-card" aria-label="연속 일기 기록">
      <div className="diary-streak-calendar-summary">
        <img
          className={`diary-streak-calendar-mascot${completed ? " is-complete" : ""}`}
          src={completed ? MASCOT_COMPLETE_URL : MASCOT_IDLE_URL}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <div>
          <span>연속 일기</span>
          <strong>
            {snapshot === null
              ? progress.status === "error"
                ? "확인하지 못했어요"
                : "기록을 불러오는 중"
              : `${snapshot.currentStreak}일`}
          </strong>
        </div>
        <p>
          {snapshot === null
            ? progress.status === "error"
              ? "오늘 다시 들어오면 확인할게요."
              : "오늘의 도장을 확인하고 있어요."
            : `지금까지 ${snapshot.totalActivityDays}일 기록했어요`}
        </p>
      </div>
    </section>
  );
}
