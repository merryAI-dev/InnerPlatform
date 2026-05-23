export const BUSINESS_CARD_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const BUSINESS_CARD_CLIENT_TARGET_BYTES = 3 * 1024 * 1024;
export const BUSINESS_CARD_SERVER_MAX_BYTES = 8 * 1024 * 1024;
export const BUSINESS_CARD_MAX_IMAGE_DIMENSION = 1800;
export const BUSINESS_CARD_INITIAL_JPEG_QUALITY = 0.82;
export const BUSINESS_CARD_FALLBACK_JPEG_QUALITY = 0.72;

export type BusinessCardAllowedImageType = typeof BUSINESS_CARD_ALLOWED_IMAGE_TYPES[number];

export interface BusinessCardPreparedImage {
  fileName: string;
  mimeType: BusinessCardAllowedImageType;
  fileSize: number;
  contentBase64: string;
  previewUrl: string;
}

export function isBusinessCardImageType(value: unknown): value is BusinessCardAllowedImageType {
  return BUSINESS_CARD_ALLOWED_IMAGE_TYPES.includes(value as BusinessCardAllowedImageType);
}

export function stripDataUrlPrefix(value: string): string {
  const text = String(value || '');
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0) return text;
  return text.slice(commaIndex + 1);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image'));
    image.src = dataUrl;
  });
}

function calculateContainedSize(width: number, height: number, maxDimension: number) {
  if (width <= 0 || height <= 0) return { width: maxDimension, height: maxDimension };
  const largest = Math.max(width, height);
  if (largest <= maxDimension) return { width, height };
  const scale = maxDimension / largest;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function compressImageToJpeg(file: File, quality: number): Promise<Blob | null> {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const size = calculateContainedSize(image.naturalWidth, image.naturalHeight, BUSINESS_CARD_MAX_IMAGE_DIMENSION);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, size.width, size.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

export async function prepareBusinessCardImage(file: File): Promise<BusinessCardPreparedImage> {
  if (!isBusinessCardImageType(file.type)) {
    throw new Error('지원되는 이미지 형식은 JPG, PNG, WebP입니다.');
  }
  if (file.size > BUSINESS_CARD_SERVER_MAX_BYTES) {
    throw new Error('이미지는 8MB 이하로 업로드해 주세요.');
  }

  let outputFile = file;
  let mimeType: BusinessCardAllowedImageType = file.type;

  if (file.size > BUSINESS_CARD_CLIENT_TARGET_BYTES || file.type !== 'image/jpeg') {
    const firstPass = await compressImageToJpeg(file, BUSINESS_CARD_INITIAL_JPEG_QUALITY);
    const compressed = firstPass && firstPass.size > BUSINESS_CARD_CLIENT_TARGET_BYTES
      ? await compressImageToJpeg(file, BUSINESS_CARD_FALLBACK_JPEG_QUALITY)
      : firstPass;
    if (compressed) {
      outputFile = new File([compressed], file.name.replace(/\.[^.]+$/, '') || 'business-card.jpg', { type: 'image/jpeg' });
      mimeType = 'image/jpeg';
    }
  }

  if (outputFile.size > BUSINESS_CARD_SERVER_MAX_BYTES) {
    throw new Error('압축 후에도 이미지가 8MB를 초과합니다. 더 작은 이미지로 다시 시도해 주세요.');
  }

  const dataUrl = await readFileAsDataUrl(outputFile);
  return {
    fileName: outputFile.name || file.name || 'business-card.jpg',
    mimeType,
    fileSize: outputFile.size,
    contentBase64: stripDataUrlPrefix(dataUrl),
    previewUrl: dataUrl,
  };
}
