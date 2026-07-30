import { Modal } from "@toss/tds-mobile";
import { useRef, useState } from "react";

import { DiaryExportError, exportDiaryImage } from "../services/diaryExport";
import { DiaryShareError, shareDiaryAppLink } from "../services/diaryShare";
import { DiaryButton } from "./DiaryButton";

interface DiaryShareModalProps {
  open: boolean;
  imageDataUrl: string;
  fileName: string;
  onClose: () => void;
  onStartNew: () => void;
}

type ShareAction = "save" | "share";

type ActionFeedback = {
  message: string;
};

export function DiaryShareModal({
  open,
  imageDataUrl,
  fileName,
  onClose,
  onStartNew,
}: DiaryShareModalProps) {
  const [busyAction, setBusyAction] = useState<ShareAction | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const completionTitleRef = useRef<HTMLHeadingElement>(null);

  const run = async (action: ShareAction) => {
    if (busyAction !== null) {
      return;
    }

    setFeedback(null);
    setBusyAction(action);

    try {
      if (action === "save") {
        await exportDiaryImage(imageDataUrl, fileName);
      } else {
        await shareDiaryAppLink();
      }
    } catch (error) {
      const message =
        error instanceof DiaryShareError || error instanceof DiaryExportError
          ? error.userMessage
          : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

      setFeedback({ message });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Modal.Overlay />

      <Modal.Content
        className="app-modal-panel"
        aria-labelledby="diary-completion-title"
        aria-describedby="diary-completion-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          completionTitleRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="app-modal-layout diary-share-layout">
          <div className="diary-share-body">
            <div className="diary-share-summary">
              <h2
                ref={completionTitleRef}
                id="diary-completion-title"
                className="app-modal-title diary-share-summary-title"
                tabIndex={-1}
              >
                완성 이미지 저장하기
              </h2>

              <p
                id="diary-completion-description"
                className="diary-share-description"
              >
                그림일기를 기기에 보관하거나 앱을 공유할 수 있어요.
              </p>
            </div>

            <div className="diary-share-preview-wrap">
              <img
                className="diary-share-preview"
                src={imageDataUrl}
                alt="완성된 그림일기"
              />
            </div>

            <p className="diary-share-note">
              이미지 저장 시 기기의 저장 화면이 열릴 수 있어요.
            </p>
          </div>

          <div className="app-modal-footer diary-share-footer">
            <div className="diary-share-primary-actions">
              <DiaryButton
                stable
                fullWidth
                disabled={busyAction !== null}
                aria-busy={busyAction === "save"}
                onClick={() => void run("save")}
              >
                이미지 저장하기
              </DiaryButton>

              <DiaryButton
                tone="secondary"
                stable
                fullWidth
                disabled={busyAction !== null && busyAction !== "share"}
                aria-busy={busyAction === "share"}
                onClick={() => void run("share")}
              >
                앱 공유하기
              </DiaryButton>
            </div>

            {feedback !== null && (
              <p
                className="diary-share-feedback diary-share-feedback-error"
                role="alert"
              >
                {feedback.message}
              </p>
            )}

            <div className="diary-share-secondary-actions">
              <button
                type="button"
                className="diary-share-text-action"
                disabled={busyAction !== null}
                onClick={onClose}
              >
                계속 보기
              </button>

              <span className="diary-share-action-divider" aria-hidden />

              <button
                type="button"
                className="diary-share-text-action"
                disabled={busyAction !== null}
                onClick={onStartNew}
              >
                새 일기 쓰기
              </button>
            </div>
          </div>
        </div>
      </Modal.Content>
    </Modal>
  );
}
