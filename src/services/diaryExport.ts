import {
  getOperationalEnvironment,
  saveBase64Data,
} from "@apps-in-toss/web-framework";

export class DiaryExportError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "DiaryExportError";
  }
}

function isInsideTossApp(): boolean {
  try {
    const environment = getOperationalEnvironment();
    return environment === "toss" || environment === "sandbox";
  } catch {
    return false;
  }
}

/**
 * 완성된 그림일기 이미지를 기기에 저장합니다.
 * `dataUrl`은 canvas.toDataURL()로 생성된 Base64 Data URL이어야 합니다.
 */
export async function exportDiaryImage(
  dataUrl: string,
  fileName: string,
): Promise<void> {
  const commaIndex = dataUrl.indexOf(",");

  if (commaIndex === -1) {
    throw new DiaryExportError("이미지를 만들지 못했어요. 다시 시도해 주세요.");
  }

  if (isInsideTossApp()) {
    try {
      await saveBase64Data({
        data: dataUrl.slice(commaIndex + 1),
        fileName,
        mimeType: "image/jpeg",
      });
      return;
    } catch {
      throw new DiaryExportError(
        "그림일기를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }

  try {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = fileName;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    throw new DiaryExportError(
      "그림일기를 다운로드하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
}
