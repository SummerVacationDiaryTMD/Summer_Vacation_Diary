import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";

import { cropImageToThreeByTwo } from "../utils/image";

interface PhotoCropModalProps {
  imageDataUrl: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
  onError: () => void;
}

export function PhotoCropModal({
  imageDataUrl,
  onCancel,
  onConfirm,
  onError,
}: PhotoCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  const confirmCrop = async () => {
    if (croppedAreaPixels === null || saving) {
      return;
    }

    setSaving(true);
    try {
      const dataUrl = await cropImageToThreeByTwo(
        imageDataUrl,
        croppedAreaPixels,
        rotation,
      );
      onConfirm(dataUrl);
    } catch {
      setSaving(false);
      onError();
    }
  };

  return createPortal(
    <div
      className="photo-crop-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-crop-title"
    >
      <header className="photo-crop-header">
        <button
          type="button"
          className="photo-crop-action"
          onClick={onCancel}
          disabled={saving}
        >
          취소
        </button>
        <strong id="photo-crop-title">사진 영역 선택</strong>
        <button
          type="button"
          className="photo-crop-action"
          onClick={confirmCrop}
          disabled={croppedAreaPixels === null || saving}
        >
          {saving ? "처리 중" : "완료"}
        </button>
      </header>

      <div className="photo-crop-body">
        <Cropper
          image={imageDataUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={3 / 2}
          objectFit="cover"
          minZoom={1}
          maxZoom={3}
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, areaPixels) => {
            setCroppedAreaPixels(areaPixels);
          }}
          style={{
            cropAreaStyle: {
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.9)",
            },
          }}
        />
      </div>

      <div className="photo-crop-controls">
        <button
          type="button"
          className="photo-crop-rotate"
          disabled={saving}
          onClick={() => setRotation((current) => (current + 90) % 360)}
        >
          ↻ 90° 회전
        </button>
        <label htmlFor="photo-crop-zoom">사진 확대</label>
        <input
          id="photo-crop-zoom"
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <p>사진을 움직여 일기에 담을 3:2 영역을 선택해 주세요.</p>
      </div>
    </div>,
    document.body,
  );
}
