import { Button, Modal } from "@toss/tds-mobile";
import { useState } from "react";

import { DiaryExportError, exportDiaryImage } from "../services/diaryExport";
import { DiaryShareError, shareDiaryAppLink } from "../services/diaryShare";

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

      <Modal.Content className="diary-share-modal">
        <div className="diary-share-content">
          <div className="diary-share-body">
            <div>
              <h2 className="diary-share-title">그림일기가 완성됐어요</h2>

              <p className="diary-share-description">
                완성 이미지를 저장하거나 친구에게 앱을 알려주세요.
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

          <div className="diary-share-footer">
            <div className="diary-share-primary-actions">
              <Button
                className="app-stable-button-state summer-diary-button summer-diary-button-primary"
                display="block"
                disabled={busyAction !== null && busyAction !== "save"}
                loading={busyAction === "save"}
                onClick={() => void run("save")}
              >
                이미지 저장하기
              </Button>

              <Button
                className="app-stable-button-state summer-diary-button summer-diary-button-secondary"
                display="block"
                disabled={busyAction !== null && busyAction !== "share"}
                variant="weak"
                color="dark"
                loading={busyAction === "share"}
                onClick={() => void run("share")}
              >
                앱 공유하기
              </Button>
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
