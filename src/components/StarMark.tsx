import { useId, type CSSProperties } from "react";

import { pickStarMark, type StarPlacement } from "../utils/starMarks";

interface StarMarkProps {
  placement: StarPlacement;
  style: CSSProperties;
}

export function StarMark({ placement, style }: StarMarkProps) {
  const maskId = `diary-star-${useId().replace(/:/g, "")}`;
  const mark = pickStarMark(placement.row, placement.column);

  return (
    <svg
      className="diary-star-mark"
      style={style}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <mask
          id={maskId}
          x="0"
          y="0"
          width="100"
          height="100"
          maskUnits="userSpaceOnUse"
        >
          <path
            className="diary-star-path"
            d={mark.path}
            pathLength="1"
            fill="none"
            stroke="white"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            className="diary-star-mask-finish"
            x="0"
            y="0"
            width="100"
            height="100"
            fill="white"
          />
        </mask>
      </defs>

      <image
        href={mark.url}
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="none"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
