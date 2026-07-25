const SOURCE_WIDTH = 96;
const SOURCE_HEIGHT = 112;
const MOSAIC_COLUMNS = 6;
const MOSAIC_ROWS = 7;

interface TextMosaicOptions {
  fontFamily: string;
  seed: number;
}

export function drawTextMosaic(
  context: CanvasRenderingContext2D,
  character: string,
  x: number,
  y: number,
  width: number,
  height: number,
  { fontFamily, seed }: TextMosaicOptions,
) {
  const source = document.createElement("canvas");
  source.width = SOURCE_WIDTH;
  source.height = SOURCE_HEIGHT;
  const sourceContext = source.getContext("2d");
  if (sourceContext === null) return;

  sourceContext.fillStyle = "#f7efe4";
  sourceContext.fillRect(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);
  sourceContext.fillStyle = "#3f3934";
  sourceContext.font = `700 82px ${fontFamily}`;
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  sourceContext.translate((seed % 3) - 1, ((seed * 5) % 3) - 1);
  sourceContext.fillText(character, SOURCE_WIDTH / 2, SOURCE_HEIGHT * 0.52);

  const pixels = document.createElement("canvas");
  pixels.width = MOSAIC_COLUMNS;
  pixels.height = MOSAIC_ROWS;
  const pixelContext = pixels.getContext("2d");
  if (pixelContext === null) return;

  pixelContext.imageSmoothingEnabled = true;
  pixelContext.drawImage(
    source,
    0,
    0,
    SOURCE_WIDTH,
    SOURCE_HEIGHT,
    0,
    0,
    MOSAIC_COLUMNS,
    MOSAIC_ROWS,
  );

  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    pixels,
    0,
    0,
    MOSAIC_COLUMNS,
    MOSAIC_ROWS,
    x,
    y,
    width,
    height,
  );
  context.restore();
}
