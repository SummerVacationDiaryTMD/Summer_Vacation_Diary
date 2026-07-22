import { Button, Top, useDialog, useToast } from "@toss/tds-mobile";
import { SafeAreaInsets } from "@apps-in-toss/web-framework";
import { useEffect, useState, type ReactNode } from "react";

import "./App.css";
import { DiaryShareModal } from "./components/DiaryShareModal";
import { PhotoUploadStep } from "./components/PhotoUploadStep";
import { PreviewStep } from "./components/PreviewStep";
import { WriteStep } from "./components/WriteStep";
import { CONTENT_MIN_LENGTH } from "./constants/diary";
import { useDiaryAnalysis } from "./hooks/useDiaryAnalysis";
import { useDiaryDraft } from "./hooks/useDiaryDraft";
import { useSketch } from "./hooks/useSketch";
import { isAiConnected } from "./services/diaryAnalysis";
import { isSketchAiConnected } from "./services/styleTransfer";
import { composeDiaryImage } from "./utils/diaryImage";

// Plain state instead of a router: the flow is a strict 3-step wizard with no
// deep links yet, so a router would add dependency weight without benefit.
// If stage 2+ needs shareable URLs, this maps 1:1 onto routes later.
type Step = "upload" | "write" | "preview";

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
    subtitle: "선생님의 한줄평과 함께 확인해 보세요.",
  },
};

const STEP_PROGRESS: Record<Step, { current: number; label: string }> = {
  upload: { current: 1, label: "여름 한 장" },
  write: { current: 2, label: "오늘의 이야기" },
  preview: { current: 3, label: "그림일기 완성" },
};

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
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [step, setStep] = useState<Step>("upload");
  // Always open on a fresh diary. Draft persistence remains available in the
  // hook, but this flow must not restore a previous visit's photo or text.
  const { draft, updateDraft, clearDraft } = useDiaryDraft({
    restoreOnStart: false,
  });
  // Analysis runs only while the preview is visible; results are cached by
  // input inside the hook, so re-entering preview without edits is free.
  const { state: analysisState, retry: retryAnalysis } = useDiaryAnalysis(
    draft,
    step === "preview",
  );
  // The drawing conversion starts when the user commits to writing (leaves
  // the upload step): its 30-60s latency then overlaps with typing time, and
  // an abandoned photo pick never spends an API call.
  const { state: sketchState, retry: retrySketch } = useSketch(
    draft,
    updateDraft,
    step !== "upload",
  );
  const { openConfirm } = useDialog();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [finishedDiary, setFinishedDiary] = useState<{
    imageDataUrl: string;
    fileName: string;
  } | null>(null);

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
      <main className="onboarding" aria-label="나의 여름방학일기 시작 화면">
        <video
          className="onboarding-video"
          src="/onboarding.mp4"
          poster="/onboarding-poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="onboarding-title-wrap">
          <h1 className="onboarding-title">나의 여름방학일기</h1>
        </div>
        <div className="onboarding-action-area">
          <button
            className="onboarding-start-button"
            type="button"
            onClick={() => setShowOnboarding(false)}
          >
            시작하기
          </button>
        </div>
      </main>
    );
  }

  const handleStartWriting = () => {
    if (!canWrite) {
      return;
    }

    // PhotoUploadStep already collects the required processing consent before
    // a photo can enter the draft, so another confirmation here would repeat
    // the same notice and interrupt the user a second time.
    setStep("write");
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
    const commentFailed = analysisState.status === "error";

    if (!drawingLoading && !commentLoading && commentFailed) {
      // Nothing will finish on its own — waiting wouldn't help, so offer a
      // retry (the analysis hook only re-runs on an explicit retry) or a save
      // without the comment.
      const retry = await openConfirm({
        title: "선생님 한줄평을 불러오지 못했어요",
        description:
          "다시 시도해서 한줄평과 첨삭까지 담거나, 지금 이대로 저장할 수 있어요.",
        confirmButton: "다시 시도",
        cancelButton: "이대로 저장",
      });
      if (retry) {
        retryAnalysis();
        return;
      }
    } else if (drawingLoading || commentLoading) {
      // Name only what is actually still generating (not a fixed "both"),
      // so the dialog never claims a piece that is already done.
      const pending = [
        drawingLoading ? "색연필 그림" : null,
        commentLoading ? "선생님 한줄평" : null,
      ].filter((part): part is string => part !== null);
      const proceed = await openConfirm({
        title: "아직 그림일기가 만들어지고 있어요",
        description: `조금 기다리면 ${pending.join("과 ")}까지 담아 저장할 수 있어요. 지금 이대로 저장할까요?`,
        confirmButton: "이대로 저장",
        cancelButton: "기다릴게요",
      });
      if (!proceed) {
        return;
      }
    }

    setSaving(true);
    try {
      const imageDataUrl = await composeDiaryImage({
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
    <main className={`app-shell app-shell-${step}`}>
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
          onPhotoChange={(dataUrl) => {
            // A sketch belongs to exactly one photo — replacing the photo
            // must drop the old drawing in the same state update, or the
            // preview could pair the new photo with the previous sketch.
            updateDraft({ photoDataUrl: dataUrl, sketchDataUrl: null });
          }}
        />
      )}
      {step === "write" && <WriteStep draft={draft} onChange={updateDraft} />}
      {step === "preview" && (
        <PreviewStep
          draft={draft}
          analysisState={analysisState}
          onRetry={retryAnalysis}
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
            setStep("upload");
          }}
        />
      )}

      {step === "upload" && (
        <AppBottomBar>
          <Button
            className="app-stable-button-state"
            display="block"
            disabled={!canWrite}
            onClick={handleStartWriting}
          >
            일기 쓰러 가기
          </Button>
        </AppBottomBar>
      )}
      {step === "write" && (
        <AppBottomBar double>
          <Button
            className="app-stable-button-state"
            display="block"
            color="dark"
            variant="weak"
            onClick={() => setStep("upload")}
          >
            이전
          </Button>
          <Button
            className="app-stable-button-state"
            display="block"
            disabled={!canPreview}
            onClick={() => setStep("preview")}
          >
            미리보기
          </Button>
        </AppBottomBar>
      )}
      {step === "preview" && (
        <AppBottomBar double>
          <Button
            className="app-stable-button-state"
            display="block"
            color="dark"
            variant="weak"
            onClick={() => setStep("write")}
          >
            수정하기
          </Button>
          <Button
            className="app-stable-button-state"
            display="block"
            loading={saving}
            onClick={handleFinish}
          >
            완성하기
          </Button>
        </AppBottomBar>
      )}
    </main>
  );
}

export default App;
