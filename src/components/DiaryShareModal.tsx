import { Button, Modal, useToast } from "@toss/tds-mobile";
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

export function DiaryShareModal({
  open,
  imageDataUrl,
  fileName,
  onClose,
  onStartNew,
}: DiaryShareModalProps) {
  const [busyAction, setBusyAction] = useState<ShareAction | null>(null);
  const toast = useToast();

  const run = async (action: ShareAction) => {
    if (busyAction !== null) {
      return;
    }
    setBusyAction(action);
    try {
      if (action === "save") {
        const outcome = await exportDiaryImage(imageDataUrl, fileName);
        toast.openToast(
          outcome === "saved"
            ? "그림일기를 기기에 저장했어요."
            : "그림일기를 다운로드했어요.",
        );
      } else {
        const outcome = await shareDiaryAppLink();
        if (outcome === "copied") {
          toast.openToast("공유 기능이 없어 앱 링크를 복사했어요.");
        }
      }
    } catch (error) {
      const message =
        error instanceof DiaryShareError || error instanceof DiaryExportError
          ? error.userMessage
          : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
      toast.openToast(message);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Modal.Overlay />
      <Modal.Content className="diary-share-modal">
        <div className="diary-share-content">
          <div className="modal-scroll-body diary-share-scroll-body">
            <div>
              <h2 className="diary-share-title">그림일기가 완성됐어요</h2>
              <p className="diary-share-description">
                이미지로 저장하거나 친구에게 앱 링크를 공유해 보세요.
              </p>
            </div>

            <img
              className="diary-share-preview"
              src={imageDataUrl}
              alt="완성된 그림일기"
            />

            <div className="diary-share-actions">
              <Button
                display="block"
                disabled={busyAction !== null && busyAction !== "save"}
                loading={busyAction === "save"}
                onClick={() => void run("save")}
              >
                이미지 저장
              </Button>
              <Button
                display="block"
                disabled={busyAction !== null && busyAction !== "share"}
                variant="weak"
                color="dark"
                loading={busyAction === "share"}
                onClick={() => void run("share")}
              >
                공유하기
              </Button>
            </div>

            <p className="diary-share-note">
              공유하기를 누르면 설치된 메신저·SNS 앱을 선택할 수 있어요.
            </p>
          </div>

          <div className="diary-share-footer">
            <Button
              display="block"
              variant="weak"
              color="dark"
              disabled={busyAction !== null}
              onClick={onClose}
            >
              계속 보기
            </Button>
            <Button
              display="block"
              disabled={busyAction !== null}
              onClick={onStartNew}
            >
              새 일기 쓰기
            </Button>
          </div>
        </div>
      </Modal.Content>
    </Modal>
  );
}
