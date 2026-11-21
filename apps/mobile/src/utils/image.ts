import * as ImageManipulator from 'expo-image-manipulator';
import type { UploadFile } from '../api/client';

/** Max edge (px) of an uploaded prescription or report photo (design.md 6.2). */
export const MAX_EDGE = 1600;
/** Target size ceiling. The server accepts up to 4MB; we aim well under 800KB. */
export const TARGET_BYTES = 800 * 1024;

/**
 * On-device preprocessing: resize so the longest side is at most 1600px and compress to WebP with
 * expo-image-manipulator. There is no auto-crop: the confirm screen is the safety net before upload.
 */
export async function prepareImage(
  uri: string,
  width?: number,
  height?: number,
): Promise<UploadFile & { width: number; height: number }> {
  const longest = Math.max(width ?? 0, height ?? 0);
  const resize =
    longest > MAX_EDGE || longest === 0
      ? width && height && width >= height
        ? { width: MAX_EDGE }
        : { height: MAX_EDGE }
      : null;

  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  if (resize) ctx.resize(resize);
  const rendered = await ctx.renderAsync();
  // Step quality down until the file is small enough (best effort, three tries).
  let result = await rendered.saveAsync({
    format: ImageManipulator.SaveFormat.WEBP,
    compress: 0.8,
  });
  for (const q of [0.65, 0.5]) {
    const size = await fileSize(result.uri);
    if (size === null || size <= TARGET_BYTES) break;
    result = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.WEBP, compress: q });
  }
  return {
    uri: result.uri,
    name: 'capture.webp',
    type: 'image/webp',
    width: result.width,
    height: result.height,
  };
}

async function fileSize(uri: string): Promise<number | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return blob.size;
  } catch {
    return null;
  }
}
