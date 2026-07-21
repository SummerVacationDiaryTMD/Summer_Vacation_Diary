import {
  getOperationalEnvironment,
  getTossShareLink,
  setClipboardText,
  share as shareThroughToss,
} from "@apps-in-toss/web-framework";

const APP_DEEP_LINK = "intoss://summer-vacation-diary";
const SHARE_TITLE = "나의 여름방학일기";
const SHARE_TEXT = "사진 한 장으로 나만의 여름방학 그림일기를 만들어 보세요!";

export type LinkShareOutcome = "shared" | "copied" | "cancelled";
export type ImageShareOutcome = "shared" | "unsupported" | "cancelled";

export class DiaryShareError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "DiaryShareError";
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

function browserFallbackUrl(): string {
  return window.location.href;
}

/** A recipient opens the mini-app in Toss, or the Toss install page otherwise. */
export async function getDiaryAppShareLink(): Promise<string> {
  if (isInsideTossApp()) {
    try {
      return await getTossShareLink(APP_DEEP_LINK);
    } catch {
      throw new DiaryShareError(
        "공유 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }
  return browserFallbackUrl();
}

async function copyWithBrowser(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Older WebViews do not expose navigator.clipboard. Keep the fallback small
  // and remove the temporary element immediately after the synchronous copy.
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) {
    throw new Error("copy failed");
  }
}

export async function copyDiaryAppLink(): Promise<void> {
  const link = await getDiaryAppShareLink();
  try {
    if (isInsideTossApp()) {
      await setClipboardText(link);
    } else {
      await copyWithBrowser(link);
    }
  } catch {
    throw new DiaryShareError(
      "링크를 복사하지 못했어요. 클립보드 권한을 확인해 주세요.",
    );
  }
}

/** Opens Toss/OS sharing. KakaoTalk appears when installed and available. */
export async function shareDiaryAppLink(): Promise<LinkShareOutcome> {
  const link = await getDiaryAppShareLink();
  const message = `${SHARE_TEXT}\n${link}`;

  try {
    if (isInsideTossApp()) {
      await shareThroughToss({ message });
      return "shared";
    }
    if (navigator.share !== undefined) {
      await navigator.share({
        title: SHARE_TITLE,
        text: SHARE_TEXT,
        url: link,
      });
      return "shared";
    }
    await copyWithBrowser(link);
    return "copied";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "cancelled";
    }
    throw new DiaryShareError(
      "공유창을 열지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
}

function dataUrlToFile(dataUrl: string, fileName: string): File {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const mime = /^data:([^;]+);base64$/.exec(header)?.[1];
  if (comma === -1 || mime === undefined) {
    throw new DiaryShareError("공유할 이미지를 준비하지 못했어요.");
  }

  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mime });
}

/**
 * Uses the OS file share sheet. Instagram and other SNS apps appear only when
 * the device/browser reports that they can accept this image.
 */
export async function shareDiaryImage(
  dataUrl: string,
  fileName: string,
): Promise<ImageShareOutcome> {
  const file = dataUrlToFile(dataUrl, fileName);
  let shareText = SHARE_TEXT;
  try {
    shareText = `${SHARE_TEXT}\n${await getDiaryAppShareLink()}`;
  } catch {
    // Sharing the user's image is still useful if link generation is briefly
    // unavailable, so do not turn that secondary failure into a hard stop.
  }
  const shareData: ShareData = {
    title: SHARE_TITLE,
    text: shareText,
    files: [file],
  };

  if (
    navigator.share === undefined ||
    navigator.canShare === undefined ||
    !navigator.canShare({ files: [file] })
  ) {
    return "unsupported";
  }

  try {
    await navigator.share(shareData);
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "cancelled";
    }
    throw new DiaryShareError(
      "이미지 공유창을 열지 못했어요. 이미지를 저장한 뒤 공유해 주세요.",
    );
  }
}
