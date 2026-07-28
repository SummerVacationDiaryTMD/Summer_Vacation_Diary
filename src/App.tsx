import { Top, useDialog, useToast } from "@toss/tds-mobile";
import { SafeAreaInsets } from "@apps-in-toss/web-framework";
import { useEffect, useRef, useState, type ReactNode } from "react";

import "./App.css";
import { DiaryButton } from "./components/DiaryButton";
import { DiaryShareModal } from "./components/DiaryShareModal";
import { PhotoUploadStep } from "./components/PhotoUploadStep";
import { PreviewStep } from "./components/PreviewStep";
import { WriteStep } from "./components/WriteStep";
import { CONTENT_MIN_LENGTH } from "./constants/diary";
import {
  isActionSpent,
  isRegionBlocked,
  refreshAiQuota,
  useAiQuota,
} from "./hooks/useAiQuota";
import { useDiaryAnalysis } from "./hooks/useDiaryAnalysis";
import { useDiaryDraft } from "./hooks/useDiaryDraft";
import { useSketch } from "./hooks/useSketch";
import { composeDiaryImage } from "./utils/diaryImage";
import { isAiConnected } from "./services/diaryAnalysis";
import { isSketchAiConnected } from "./services/styleTransfer";

// Plain state instead of a router: the flow is a strict 3-step wizard with no
// deep links yet, so a router would add dependency weight without benefit.
// If stage 2+ needs shareable URLs, this maps 1:1 onto routes later.
type Step = "upload" | "write" | "preview";

interface DiaryConfirmOptions {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

// HHMMSS from the local clock, appended to the saved file name so two saves
// on the same date don't produce an identical name.
function clockSuffix(): string {
  const now = new Date();
  return (
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0")
  );
}

const STEP_HEADERS: Record<Step, { title: string; subtitle: string }> = {
  upload: {
    title: "어떤 여름이었나요?",
    subtitle: "그림일기로 만들 사진 1장을 골라주세요.",
  },
  write: {
    title: "일기 쓰기",
    subtitle: "사진 속 이야기를 짧게 적어주세요.",
  },
  preview: {
    title: "그림일기 미리보기",
    subtitle: "선생님의 한마디와 함께 확인해 보세요.",
  },
};

const STEP_PROGRESS: Record<Step, { current: number; label: string }> = {
  upload: { current: 1, label: "여름 한 장" },
  write: { current: 2, label: "오늘의 이야기" },
  preview: { current: 3, label: "마지막 확인" },
};

const ONBOARDING_DECORATIONS = [
  { name: "sun", file: "sun.png" },
  { name: "cloud-big", file: "big_cloud.png" },
  { name: "cloud-small", file: "small_cloud2.png" },
  { name: "seagull", file: "seagull.png" },
  { name: "seagull-two", file: "seagull.png" },
  { name: "sailboat", file: "sailboat.png" },
  { name: "dolphin", file: "dolphin.png" },
  { name: "palm-tree", file: "palm_tree.png" },
  { name: "girl", file: "LittleGirlAndCat.png" },
  { name: "sandcastle", file: "sancastle.png" },
  { name: "beach-ball", file: "beach_ball.png" },
  { name: "crab", file: "crab.png" },
] as const;

const ONBOARDING_TITLE_LINES = [
  [
    { name: "na", file: "title-na.png" },
    { name: "ui", file: "title-ui.png" },
  ],
  [
    { name: "yeo", file: "title-yeo.png" },
    { name: "reum", file: "title-reum.png" },
    { name: "bang", file: "title-bang.png" },
    { name: "hak", file: "title-hak.png" },
  ],
  [
    { name: "il", file: "title-il.png" },
    { name: "gi", file: "title-gi.png" },
  ],
] as const;

function AppBottomBar({
  children,
  double = false,
}: {
  children: ReactNode;
  double?: boolean;
}) {
  return (
    <div className="app-bottom-bar">
      <div
        className={`app-bottom-bar-content${double ? " app-bottom-bar-content-double" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

function App() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [step, setStep] = useState<Step>("upload");
  // Always open on a fresh diary. Draft persistence remains available in the
  // hook, but this flow must not restore a previous visit's photo or text.
  const { draft, updateDraft, clearDraft } = useDiaryDraft({
    restoreOnStart: false,
  });
  // Not part of the draft: it is only a cache key, and persisting it would mean
  // versioning the draft shape for something that dies with the session anyway.
  const [photoSourceHash, setPhotoSourceHash] = useState<string | null>(null);
  const quota = useAiQuota();
  // Refused outright by country, which unlike the daily budgets never comes
  // back — so it gates both operations rather than one.
  const regionBlocked = isRegionBlocked(quota);
  // Gate on "would this actually reach the server". Mock and test mode never
  // do, so they must never be blocked by a counter they don't spend.
  const sketchAllowed =
    !isSketchAiConnected || (!regionBlocked && !isActionSpent(quota, "sketch"));
  const analyzeAllowed =
    !isAiConnected || (!regionBlocked && !isActionSpent(quota, "analyze"));

  // Analysis is triggered explicitly by 검사 받기, not by opening the preview:
  // at five checks a day, re-running on every edit would spend the budget on
  // typo fixes. Results are cached by input inside the hook, so asking again
  // without editing is free.
  const { state: analysisState, run: runAnalysis } = useDiaryAnalysis(draft);
  // The drawing conversion starts when the user commits to writing (leaves
  // the upload step): its 30-60s latency then overlaps with typing time, and
  // an abandoned photo pick never spends an API call.
  const {
    state: sketchState,
    retry: retrySketch,
    discardSketch,
    isDrawingInProgress,
  } = useSketch(
    draft,
    updateDraft,
    step !== "upload",
    sketchAllowed,
    photoSourceHash,
  );
  const { openAlert, openConfirm } = useDialog();
  const openDiaryConfirm = ({
    title,
    description,
    confirmLabel,
    cancelLabel,
  }: DiaryConfirmOptions) =>
    openConfirm({
      title,
      description,
      confirmButton: <DiaryButton>{confirmLabel}</DiaryButton>,
      cancelButton: <DiaryButton tone="secondary">{cancelLabel}</DiaryButton>,
    });
  const regionNoticeShownRef = useRef(false);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [finishedDiary, setFinishedDiary] = useState<{
    imageDataUrl: string;
    fileName: string;
  } | null>(null);

  const [hasVisitedWrite, setHasVisitedWrite] = useState(false);
  const [hasVisitedPreview, setHasVisitedPreview] = useState(false);
  const [showSketchQuotaNotice, setShowSketchQuotaNotice] = useState(false);
  const [showAnalyzeQuotaNotice, setShowAnalyzeQuotaNotice] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-onboarding-open", showOnboarding);

    return () => {
      root.removeAttribute("data-onboarding-open");
    };
  }, [showOnboarding]);

  // quota-status never consumes a request. Start it while the onboarding is
  // visible so the upload step can show the real remaining count immediately
  // in the usual case, instead of beginning the network round trip on tap.
  useEffect(() => {
    void refreshAiQuota();
  }, []);

  useEffect(() => {
    const applyInsets = (insets: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    }) => {
      const root = document.documentElement;
      root.style.setProperty("--toss-safe-area-top", `${insets.top}px`);
      root.style.setProperty("--toss-safe-area-right", `${insets.right}px`);
      root.style.setProperty("--toss-safe-area-bottom", `${insets.bottom}px`);
      root.style.setProperty("--toss-safe-area-left", `${insets.left}px`);
    };

    try {
      applyInsets(SafeAreaInsets.get());
      return SafeAreaInsets.subscribe({ onEvent: applyInsets });
    } catch {
      // Plain browsers do not have the Toss bridge. CSS env() remains the
      // fallback there, so the local development flow needs no mock values.
      return undefined;
    }
  }, []);

  // Once per session, and only after onboarding: the quota fetch that reveals
  // this is fired by 시작하기, so before that there is nothing to say. The ref
  // guard is also what makes openAlert's reference stability irrelevant. The
  // dialog portals, so the onboarding early return below does not hide it.
  useEffect(() => {
    if (showOnboarding || !regionBlocked || regionNoticeShownRef.current) {
      return;
    }
    regionNoticeShownRef.current = true;
    void openAlert({
      title: "해외 IP는 AI 기능을 사용할 수 없어요",
      description:
        "그림 그리기와 일기 검사는 한국에서만 이용할 수 있어요. 사진 그대로 그림일기를 만드는 건 그대로 할 수 있어요.",
      alertButton: <DiaryButton placement="dialog">확인</DiaryButton>,
      closeOnDimmerClick: false,
    });
  }, [openAlert, regionBlocked, showOnboarding]);

  const header = STEP_HEADERS[step];
  const progress = STEP_PROGRESS[step];
  const canWrite = draft.photoDataUrl !== null;
  // trim() on both fields so whitespace-only input can't pass validation
  // (the spec's exception handling blocks empty/too-short diaries).
  const canPreview =
    draft.title.trim() !== "" &&
    Array.from(draft.content.trim()).length >= CONTENT_MIN_LENGTH;
  const includesAiGeneratedContent =
    (isSketchAiConnected && sketchState.status === "success") ||
    (isAiConnected && analysisState.status === "success");

  if (showOnboarding) {
    return (
      <main className="onboarding" aria-label="나의 여름방학 일기 시작 화면">
        <div className="onboarding-scene">
          {ONBOARDING_DECORATIONS.map(({ name, file }) => (
            <img
              key={name}
              className={`onboarding-decoration onboarding-decoration-${name}`}
              src={`/onboarding_images/${file}`}
              alt=""
              draggable={false}
            />
          ))}
          <h1 className="onboarding-title" aria-label="나의 여름방학 일기">
            {ONBOARDING_TITLE_LINES.map((line, lineIndex) => (
              <span
                key={lineIndex}
                className={`onboarding-title-line onboarding-title-line-${lineIndex + 1}`}
                aria-hidden="true"
              >
                {line.map(({ name, file }) => (
                  <img
                    key={file}
                    className={`onboarding-title-letter onboarding-title-letter-${name}`}
                    src={`/onboarding_images/${file}`}
                    alt=""
                    draggable={false}
                  />
                ))}
              </span>
            ))}
          </h1>
        </div>
        <div className="onboarding-action-area">
          <button
            className="summer-diary-button summer-diary-button-primary summer-diary-button-onboarding"
            type="button"
            onClick={() => {
              setShowOnboarding(false);
            }}
          >
            시작하기
          </button>
        </div>
      </main>
    );
  }

  const handleStartWriting = () => {
    if (!canWrite) {
      toast.openToast("먼저 사진을 올려주세요.", {
        gap: 15,
      });
      return;
    }

    setHasVisitedWrite(true);

    if (isActionSpent(quota, "sketch") && draft.sketchDataUrl === null) {
      toast.openToast("오늘 사진을 그림으로 바꿀 기회는 다 사용했어요.");
    }

    // PhotoUploadStep already collects the required processing consent before
    // a photo can enter the draft, so another confirmation here would repeat
    // the same notice and interrupt the user a second time.
    setStep("write");
  };

  const handlePreview = () => {
    const titleMissing = draft.title.trim() === "";
    const trimmedContentLength = Array.from(draft.content.trim()).length;
    const contentMissing = trimmedContentLength === 0;
    const contentTooShort = trimmedContentLength < CONTENT_MIN_LENGTH;

    if (titleMissing && contentMissing) {
      toast.openToast("제목과 일기 내용을 입력해 주세요.");
      return;
    }
    if (titleMissing && contentTooShort) {
      toast.openToast(
        `제목을 입력하고 일기를 ${CONTENT_MIN_LENGTH}자 이상 적어주세요.`,
      );
      return;
    }
    if (titleMissing) {
      toast.openToast("제목을 입력해 주세요.");
      return;
    }
    if (contentMissing) {
      toast.openToast("일기 내용을 입력해 주세요.");
      return;
    }
    if (contentTooShort) {
      toast.openToast(
        `일기 내용을 ${CONTENT_MIN_LENGTH}자 이상 입력해 주세요.`,
      );
      return;
    }

    setHasVisitedPreview(true);

    // Navigation is never gated on the budget: with no check the preview simply
    // shows the diary without a comment, and 완성하기 still works from there.
    if (analyzeAllowed) {
      runAnalysis();
    } else if (
      isActionSpent(quota, "analyze") &&
      analysisState.status !== "success"
    ) {
      toast.openToast("오늘 일기 검사 기회는 다 사용했어요.");
    }
    setStep("preview");
  };

  // Stage 4: compose the finished diary once, then let the result sheet reuse
  // the exact same file for save, SNS share and preview.
  const handleFinish = async () => {
    if (draft.photoDataUrl === null || saving) {
      return;
    }

    // Saving with a missing piece is allowed, but never silently: the AI
    // comment / 첨삭 (MVP-required) and the drawing are the whole point, so an
    // incomplete keepsake must be a knowing choice. A sketch *error* is the
    // one exception — it falls back to the original photo, which the spec
    // explicitly endorses and the preview already communicates.
    const drawingLoading = sketchState.status === "loading";
    const commentLoading = analysisState.status === "loading";

    if (drawingLoading || commentLoading) {
      // Name only what is actually still generating (not a fixed "both"),
      // so the dialog never claims a piece that is already done.
      const pending = [
        drawingLoading ? "크레파스 그림" : null,
        commentLoading ? "선생님 한마디" : null,
      ].filter((part): part is string => part !== null);
      const proceed = await openDiaryConfirm({
        title: "아직 그림일기가 만들어지고 있어요",
        description: `조금 기다리면 ${pending.join("과 ")}까지 담아 저장할 수 있어요. 지금 이대로 저장할까요?`,
        confirmLabel: "이대로 저장",
        cancelLabel: "기다릴게요",
      });
      if (!proceed) {
        return;
      }
    } else if (analysisState.status === "error" && analysisState.retryable) {
      // Nothing will finish on its own — waiting wouldn't help, so offer a
      // retry (the analysis hook only re-runs on an explicit trigger) or a save
      // without the comment. A non-retryable failure means the daily budget is
      // gone, so it falls through and saves: asking would offer something that
      // cannot happen today.
      const retry = await openDiaryConfirm({
        title: "선생님의 한마디를 불러오지 못했어요",
        description:
          "다시 시도해서 한마디와 첨삭까지 담거나, 지금 이대로 저장할 수 있어요.",
        confirmLabel: "다시 시도",
        cancelLabel: "이대로 저장",
      });
      if (retry) {
        runAnalysis();
        return;
      }
    } else if (analysisState.status === "idle" && analyzeAllowed) {
      // Never asked for a check at all. The comment and 첨삭 are the point of
      // the app, so leaving them out has to be a knowing choice — but only ask
      // when a check is actually still possible.
      const check = await openDiaryConfirm({
        title: "아직 선생님께 검사받지 않았어요",
        description:
          "지금 검사받으면 선생님 한마디와 첨삭까지 담을 수 있어요. 오늘 남은 검사 횟수가 한 번 줄어들어요.",
        confirmLabel: "검사 받기",
        cancelLabel: "이대로 저장",
      });
      if (check) {
        runAnalysis();
        return;
      }
    }

    setSaving(true);
    try {
      const { dataUrl: imageDataUrl } = await composeDiaryImage({
        imageDataUrl: draft.sketchDataUrl ?? draft.photoDataUrl,
        title: draft.title.trim() || "제목 없는 일기",
        content: draft.content,
        date: draft.date,
        weather: draft.weather,
        analysis:
          analysisState.status === "success" ? analysisState.analysis : null,
        includesAiGeneratedContent,
      });
      setFinishedDiary({
        imageDataUrl,
        // ASCII name (some Android managers mangle Korean) + a time suffix so
        // saving twice in one day can't collide on an identical fileName.
        fileName: `summer-diary-${draft.date}-${clockSuffix()}.jpg`,
      });
    } catch {
      const message = "그림일기 이미지를 만들지 못했어요. 다시 시도해 주세요.";
      // Retry button keeps the failure recoverable in place instead of
      // vanishing with the 3s toast.
      toast.openToast(message, {
        button: {
          text: "다시 시도",
          onClick: () => void handleFinish(),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main
      className={`app-shell app-shell-${step}${isAndroid ? " app-shell-android" : ""}`}
    >
      <div className="summer-sky-accent" aria-hidden="true">
        <span className="summer-sun" />
        <span className="summer-cloud summer-cloud-one" />
        <span className="summer-cloud summer-cloud-two" />
      </div>
      <Top
        className="app-top"
        title={
          <Top.TitleParagraph size={22}>{header.title}</Top.TitleParagraph>
        }
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>
            {header.subtitle}
          </Top.SubtitleParagraph>
        }
      />

      <div
        className="summer-step-progress"
        aria-label={`그림일기 만들기 ${progress.current}단계, ${progress.label}`}
      >
        <div className="summer-step-dots" aria-hidden="true">
          {[1, 2, 3].map((item) => (
            <span
              key={item}
              className={
                item === progress.current
                  ? "is-current"
                  : item < progress.current
                    ? "is-complete"
                    : ""
              }
            />
          ))}
        </div>
        <span className="summer-step-label">
          <strong>{progress.current}/3</strong>
          {progress.label}
        </span>
      </div>

      {step === "upload" && (
        <PhotoUploadStep
          photoDataUrl={draft.photoDataUrl}
          showRecheckNotice={showSketchQuotaNotice}
          canRedraw={sketchAllowed}
          isDrawingInProgress={isDrawingInProgress}
          onPhotoChange={({
            dataUrl,
            sourceHash,
            reusedSketchDataUrl,
            redraw,
          }) => {
            setPhotoSourceHash(sourceHash);
            // 다시 그리기 means the previous drawing is gone for good. Clearing
            // the draft below is not enough: the caches would hand it straight
            // back and the ledger would still count this photo as paid for, so
            // the new request could never go out.
            if (redraw === true) {
              discardSketch(dataUrl, sourceHash);
            }
            // A sketch belongs to exactly one photo — replacing the photo
            // must drop the old drawing in the same state update, or the
            // preview could pair the new photo with the previous sketch. The
            // one exception is a drawing the user explicitly asked to reuse,
            // which also keeps the sketch hook from spending a request.
            updateDraft({
              photoDataUrl: dataUrl,
              sketchDataUrl: reusedSketchDataUrl ?? null,
            });
          }}
        />
      )}
      {step === "write" && (
        <WriteStep
          draft={draft}
          onChange={updateDraft}
          showRecheckNotice={showAnalyzeQuotaNotice}
        />
      )}
      {step === "preview" && (
        <PreviewStep
          draft={draft}
          analysisState={analysisState}
          onRetry={runAnalysis}
          sketchState={sketchState}
          onSketchRetry={retrySketch}
        />
      )}

      {finishedDiary !== null && (
        <DiaryShareModal
          open
          imageDataUrl={finishedDiary.imageDataUrl}
          fileName={finishedDiary.fileName}
          onClose={() => setFinishedDiary(null)}
          onStartNew={() => {
            setFinishedDiary(null);
            clearDraft();

            setHasVisitedWrite(false);
            setHasVisitedPreview(false);
            setShowSketchQuotaNotice(false);
            setShowAnalyzeQuotaNotice(false);

            setStep("upload");
          }}
        />
      )}

      {step === "upload" && (
        <AppBottomBar>
          <DiaryButton
            stable
            feedbackDisabled
            fullWidth
            aria-disabled={!canWrite}
            onClick={handleStartWriting}
          >
            {hasVisitedWrite ? "다시 일기 쓰러 가기" : "일기 쓰러 가기"}
          </DiaryButton>
        </AppBottomBar>
      )}
      {step === "write" && (
        <AppBottomBar double>
          <DiaryButton
            tone="secondary"
            stable
            fullWidth
            onClick={() => {
              setShowSketchQuotaNotice(true);
              setStep("upload");
            }}
          >
            사진 변경
          </DiaryButton>

          <DiaryButton
            stable
            feedbackDisabled
            fullWidth
            aria-disabled={!canPreview}
            onClick={handlePreview}
          >
            {hasVisitedPreview ? "다시 검사 받기" : "검사 받기"}
          </DiaryButton>
        </AppBottomBar>
      )}
      {step === "preview" && (
        <AppBottomBar double>
          <DiaryButton
            tone="secondary"
            stable
            fullWidth
            disabled={saving}
            onClick={() => {
              setShowAnalyzeQuotaNotice(true);
              setStep("write");
            }}
          >
            일기 수정
          </DiaryButton>

          <DiaryButton
            stable
            fullWidth
            disabled={saving}
            aria-busy={saving}
            onClick={handleFinish}
          >
            {saving ? "완성 중…" : "일기 완성하기"}
          </DiaryButton>
        </AppBottomBar>
      )}
    </main>
  );
}

export default App;
