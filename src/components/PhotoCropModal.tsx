import { useState } from "react";
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
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const confirmCrop = async () => {
    if (croppedAreaPixels === null || saving) {
      return;
    }

    setSaving(true);
    try {
      const dataUrl = await cropImageToThreeByTwo(
        imageDataUrl,
        croppedAreaPixels,
      );
      onConfirm(dataUrl);
    } catch {
      setSaving(false);
      onError();
    }
  };

  return (
    <div
      className="photo-crop-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-crop-title"
    >
      <header className="photo-crop-header">
        <button type="button" onClick={onCancel} disabled={saving}>
          취소
        </button>
        <strong id="photo-crop-title">사진 영역 선택</strong>
        <button
          type="button"
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
          aspect={3 / 2}
          minZoom={1}
          maxZoom={3}
          showGrid
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, areaPixels) => {
            setCroppedAreaPixels(areaPixels);
          }}
        />
      </div>

      <div className="photo-crop-controls">
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
    </div>
  );
}
