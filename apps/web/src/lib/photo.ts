import { translate } from "../i18n/index.ts";

export const PHOTO_PX = 256;

export async function squarePhoto(file: Blob, px = PHOTO_PX): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  canvas
    .getContext("2d")
    ?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(translate("settings.photoReadFailed")))),
      "image/webp",
      0.86,
    ),
  );
}
