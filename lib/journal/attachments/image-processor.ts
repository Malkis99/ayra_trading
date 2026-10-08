export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_MEGAPIXELS = 40; // 40 MP
export const MAX_IMAGE_PIXELS = MAX_MEGAPIXELS * 1_000_000;
export const TARGET_MAX_DIMENSION = 1600;
export const THUMBNAIL_MAX_DIMENSION = 320;
export const WEBP_QUALITY = 0.82;

export type AllowedMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ProcessedImageResult {
  originalBlob: Blob;
  previewBlob: Blob;
  mime: AllowedMimeType;
  width: number;
  height: number;
  bytes: number;
  hash: string; // SHA-256 hex
}

export function detectMimeTypeFromMagicBytes(
  buffer: ArrayBuffer
): AllowedMimeType | null {
  if (!buffer || buffer.byteLength < 8) {
    return null;
  }

  const bytes = new Uint8Array(buffer);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WEBP: RIFF .... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }

  return null;
}

export function calculateTargetDimensions(
  width: number,
  height: number,
  maxSide: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }

  const maxDimension = Math.max(width, height);
  if (maxDimension <= maxSide) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxSide / maxDimension;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function checkImageLimits(
  fileSizeBytes: number,
  width?: number,
  height?: number
): { ok: boolean; reasonCode?: "empty" | "too_large_file" | "too_large_pixels" } {
  if (fileSizeBytes <= 0) {
    return { ok: false, reasonCode: "empty" };
  }

  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return { ok: false, reasonCode: "too_large_file" };
  }

  if (width !== undefined && height !== undefined) {
    if (width <= 0 || height <= 0) {
      return { ok: false, reasonCode: "empty" };
    }
    const pixels = width * height;
    if (pixels > MAX_IMAGE_PIXELS) {
      return { ok: false, reasonCode: "too_large_pixels" };
    }
  }

  return { ok: true };
}

export async function calculateBufferSha256(buffer: ArrayBuffer): Promise<string> {
  if (
    typeof crypto !== "undefined" &&
    crypto.subtle &&
    typeof crypto.subtle.digest === "function"
  ) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Simple fallback hash if crypto.subtle is unavailable (e.g., test mocks)
  const bytes = new Uint8Array(buffer);
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash << 5) - hash + bytes[i];
    hash |= 0;
  }
  return `fallback_${Math.abs(hash).toString(16)}`;
}

export async function processImageFile(
  file: File | Blob
): Promise<ProcessedImageResult> {
  const arrayBuffer = await file.arrayBuffer();

  // 1. Magic bytes validation
  const detectedMime = detectMimeTypeFromMagicBytes(arrayBuffer);
  if (!detectedMime) {
    throw new Error("UNSUPPORTED_FORMAT");
  }

  // 2. File size limit check
  const sizeCheck = checkImageLimits(file.size);
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.reasonCode === "empty" ? "EMPTY_FILE" : "FILE_TOO_LARGE");
  }

  // 3. Hash calculation
  const sha256 = await calculateBufferSha256(arrayBuffer);

  // 4. Image decoding & Canvas re-encoding
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("DOM_NOT_AVAILABLE"));
      return;
    }

    const img = new Image();
    const blobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: detectedMime }));

    img.onload = async () => {
      URL.revokeObjectURL(blobUrl);

      const origWidth = img.naturalWidth || img.width;
      const origHeight = img.naturalHeight || img.height;

      // Check pixel bomb limit
      const pixelCheck = checkImageLimits(file.size, origWidth, origHeight);
      if (!pixelCheck.ok) {
        reject(new Error("IMAGE_TOO_LARGE_PIXELS"));
        return;
      }

      try {
        // Calculate dimensions
        const fullDim = calculateTargetDimensions(origWidth, origHeight, TARGET_MAX_DIMENSION);
        const thumbDim = calculateTargetDimensions(origWidth, origHeight, THUMBNAIL_MAX_DIMENSION);

        // Render full size canvas
        const fullCanvas = document.createElement("canvas");
        fullCanvas.width = fullDim.width;
        fullCanvas.height = fullDim.height;
        const fullCtx = fullCanvas.getContext("2d");
        if (!fullCtx) {
          reject(new Error("CANVAS_CONTEXT_FAILED"));
          return;
        }
        fullCtx.drawImage(img, 0, 0, fullDim.width, fullDim.height);

        // Render thumbnail canvas
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = thumbDim.width;
        thumbCanvas.height = thumbDim.height;
        const thumbCtx = thumbCanvas.getContext("2d");
        if (!thumbCtx) {
          reject(new Error("CANVAS_CONTEXT_FAILED"));
          return;
        }
        thumbCtx.drawImage(img, 0, 0, thumbDim.width, thumbDim.height);

        // Re-encode to WebP (fallback to JPEG if webp canvas export is unsupported)
        const exportMime = "image/webp";

        async function canvasToBlob(
          canvas: HTMLCanvasElement,
          mime: string,
          quality: number
        ): Promise<Blob> {
          const blobFromToBlob = await new Promise<Blob | null>((res) => {
            try {
              canvas.toBlob(res, mime, quality);
            } catch {
              res(null);
            }
          });

          if (blobFromToBlob && blobFromToBlob.size > 0) {
            return blobFromToBlob;
          }

          // Fallback via toDataURL
          const dataUrl = canvas.toDataURL(mime, quality);
          const parts = dataUrl.split(",");
          const byteString = atob(parts[1]);
          const mimeString = parts[0].split(":")[1].split(";")[0];
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          return new Blob([ab], { type: mimeString });
        }

        const fullBlob = await canvasToBlob(fullCanvas, exportMime, WEBP_QUALITY);
        const thumbBlob = await canvasToBlob(thumbCanvas, exportMime, WEBP_QUALITY);

        const finalMime = (fullBlob.type.includes("webp") ? "image/webp" : "image/jpeg") as AllowedMimeType;

        resolve({
          originalBlob: fullBlob,
          previewBlob: thumbBlob,
          mime: finalMime,
          width: fullDim.width,
          height: fullDim.height,
          bytes: fullBlob.size,
          hash: sha256,
        });
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("IMAGE_DECODE_FAILED"));
    };

    img.src = blobUrl;
  });
}
