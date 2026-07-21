import { Button, Checkbox, Modal, Paragraph, useToast } from "@toss/tds-mobile";
import { colors } from "@toss/tds-colors";
import { useRef, useState } from "react";

import familyDiaryPlaceholder from "../assets/family-diary-placeholder.jpg";

import { ALLOWED_IMAGE_TYPES } from "../constants/diary";
import {
  IMAGE_ERROR_MESSAGES,
  ImageProcessError,
  processImageFile,
  validateImageFile,
} from "../utils/image";

interface PhotoUploadStepProps {
  photoDataUrl: string | null;
  onPhotoChange: (dataUrl: string) => void;
}

/**
 * Step 1: pick a photo from the device.
 *
 * A plain <input type="file"> is used instead of the apps-in-toss album SDK:
 * it opens the native picker in both the local browser and the Toss WebView,
 * and it needs no permission entry in apps-in-toss.config.ts. The SDK album API can
 * replace this later if multi-select or finer permission UX becomes necessary.
 */
export function PhotoUploadStep({
  photoDataUrl,
  onPhotoChange,
}: PhotoUploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const toast = useToast();

  const requestPhotoSelection = () => {
    // Ignore clicks while a previous pick is still processing: two concurrent
    // picks could resolve out of order and leave the older photo on screen.
    if (processing) {
      return;
    }
    setAgreed(false);
    setConsentOpen(true);
  };

  const openPickerAfterConsent = () => {
    if (!agreed || processing) {
      return;
    }
    setConsentOpen(false);
    // Keep the click in this user gesture. Delaying it can make mobile
    // browsers treat the file picker as an unsolicited popup and block it.
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    // Reset the input so picking the same file again still fires onChange
    // (browsers skip the event when the value is unchanged).
    event.target.value = "";
    if (file === undefined) {
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError !== null) {
      toast.openToast(IMAGE_ERROR_MESSAGES[validationError]);
      return;
    }

    setProcessing(true);
    try {
      const processed = await processImageFile(file);
      onPhotoChange(processed.dataUrl);
    } catch (error) {
      const code =
        error instanceof ImageProcessError ? error.code : "load-failed";
      toast.openToast(IMAGE_ERROR_MESSAGES[code]);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="step-body">
      {photoDataUrl !== null ? (
        <div className="photo-selected">
          <img
            className="photo-preview"
            src={photoDataUrl}
            alt="선택한 사진 미리보기"
          />
          <Button
            variant="weak"
            color="dark"
            display="block"
            size="medium"
            loading={processing}
            onClick={requestPhotoSelection}
          >
            다른 사진 선택하기
          </Button>
          {/* The conversion itself starts on the next step (see useSketch),
              so tell the user here what will happen to their photo. */}
          <Paragraph
            typography="t7"
            color={colors.grey600}
            style={{ textAlign: "center" }}
          >
            다음 단계로 가면 사진이 색연필 그림으로 바뀌어요 ✏️
          </Paragraph>
        </div>
      ) : (
        <button
          type="button"
          className="photo-placeholder"
          onClick={requestPhotoSelection}
          disabled={processing}
        >
          <img
            className="photo-placeholder-image"
            src={familyDiaryPlaceholder}
            alt=""
            aria-hidden
          />
          <span className="photo-placeholder-copy">
            <span className="photo-placeholder-emoji" aria-hidden>
              📷
            </span>
            {/* Fixed colors pair with the fixed light placeholder background.
              Note: @toss/tds-mobile-ait currently pins colorPreference to
              "light", so adaptive.* tokens never change today — if a future
              provider honors dark mode, re-review fixed-vs-adaptive choices.
              as="span": Paragraph defaults to <div>, which is invalid inside
              a <button>; span keeps the markup valid without layout change. */}
            <Paragraph
              as="span"
              typography="t5"
              fontWeight="semibold"
              color={colors.grey800}
            >
              여름 사진 올리기
            </Paragraph>
            <Paragraph as="span" typography="t7" color={colors.grey600}>
              JPG · PNG · WEBP, 10MB 이하 사진 1장
            </Paragraph>
          </span>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        hidden
        onChange={handleFileChange}
      />

      <Modal
        open={consentOpen}
        onOpenChange={(open) => {
          setConsentOpen(open);
          if (!open) {
            setAgreed(false);
          }
        }}
      >
        <Modal.Overlay />
        <Modal.Content className="photo-consent-modal">
          <div className="photo-consent-content">
            <div className="modal-scroll-body photo-consent-scroll-body">
              <div>
                <h2 className="photo-consent-title">사진 전송 및 분석 안내</h2>
                <p className="photo-consent-description">
                  선택한 사진은 그림일기를 만들기 위해 Supabase 서버를 거쳐
                  OpenAI로 전송돼요.
                </p>
              </div>

              <ul className="photo-consent-list">
                <li>개인정보가 포함된 사진은 올리지 않는 것을 권장해요.</li>
                <li>
                  주민등록번호, 계좌번호, 비밀번호 같은 민감정보는 꼭 가려
                  주세요.
                </li>
                <li>
                  얼굴이나 다른 사람의 개인정보가 나온 사진은 가능한 피해
                  주세요.
                </li>
                <li>
                  앱에서는 사진을 그림 변환과 일기 분석 요청에만 사용해요.
                </li>
                <li>
                  남용 방지를 위해 기기 식별값과 IP를 사용량 제한에 사용해요.
                </li>
              </ul>

              <div className="photo-consent-check-row">
                <Checkbox.Line
                  checked={agreed}
                  onCheckedChange={setAgreed}
                  aria-label="사진 전송 및 분석 안내에 동의"
                />
                <button
                  type="button"
                  className="photo-consent-check-label"
                  onClick={() => setAgreed((checked) => !checked)}
                >
                  위 내용을 확인했으며 사진 전송 및 분석에 동의해요.
                </button>
              </div>
            </div>

            <div className="photo-consent-actions">
              <Button
                variant="weak"
                color="dark"
                display="block"
                onClick={() => setConsentOpen(false)}
              >
                취소
              </Button>
              <Button
                display="block"
                disabled={!agreed}
                onClick={openPickerAfterConsent}
              >
                동의하고 사진 선택
              </Button>
            </div>
          </div>
        </Modal.Content>
      </Modal>
    </div>
  );
}
