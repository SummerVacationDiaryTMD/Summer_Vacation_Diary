import { Button, Modal, useToast } from "@toss/tds-mobile";
import { useState } from "react";

import { DiaryExportError, exportDiaryImage } from "../services/diaryExport";
import {
  copyDiaryAppLink,
  DiaryShareError,
  shareDiaryAppLink,
  shareDiaryImage,
} from "../services/diaryShare";

interface DiaryShareModalProps {
  open: boolean;
  imageDataUrl: string;
  fileName: string;
  onClose: () => void;
  onStartNew: () => void;
}

type ShareAction = "save" | "copy" | "message" | "social";

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
      } else if (action === "copy") {
        await copyDiaryAppLink();
        toast.openToast("앱 링크를 복사했어요.");
      } else if (action === "message") {
        const outcome = await shareDiaryAppLink();
        if (outcome === "copied") {
          toast.openToast("공유 기능이 없어 앱 링크를 복사했어요.");
        }
      } else {
        const outcome = await shareDiaryImage(imageDataUrl, fileName);
        if (outcome === "unsupported") {
          await exportDiaryImage(imageDataUrl, fileName);
          toast.openToast(
            "이 환경은 이미지 공유를 지원하지 않아 먼저 저장했어요.",
          );
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
          <div>
            <h2 className="diary-share-title">그림일기가 완성됐어요</h2>
            <p className="diary-share-description">
              이미지로 저장하거나 친구에게 앱 링크와 결과물을 공유해 보세요.
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
              disabled={busyAction !== null && busyAction !== "copy"}
              variant="weak"
              color="dark"
              loading={busyAction === "copy"}
              onClick={() => void run("copy")}
            >
              앱 링크 복사
            </Button>
            <Button
              display="block"
              disabled={busyAction !== null && busyAction !== "message"}
              variant="weak"
              color="dark"
              loading={busyAction === "message"}
              onClick={() => void run("message")}
            >
              카카오톡 · 메시지 공유
            </Button>
            <Button
              display="block"
              disabled={busyAction !== null && busyAction !== "social"}
              variant="weak"
              color="dark"
              loading={busyAction === "social"}
              onClick={() => void run("social")}
            >
              인스타그램 · SNS 공유
            </Button>
          </div>

          <p className="diary-share-note">
            공유창에 표시되는 앱은 기기와 설치 상태에 따라 달라요. 일기 이미지는
            공개 링크로 업로드되지 않아요.
          </p>

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
