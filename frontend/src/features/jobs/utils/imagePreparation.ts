const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_TARGET_SIZE = 1.5 * 1024 * 1024;
const DEFAULT_MIN_QUALITY = 0.6;
const DEFAULT_INITIAL_QUALITY = 0.86;
const DEFAULT_MIN_DIMENSION = 640;
const JPEG_TYPE = "image/jpeg";
const SUPPORTED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export interface ImagePreparationOptions {
  maxDimension?: number;
  targetSize?: number;
  initialQuality?: number;
  minQuality?: number;
  minDimension?: number;
  signal?: AbortSignal;
}

interface ImageSource {
  width: number;
  height: number;
  close?: () => void;
}

interface ImagePreparationEnvironment {
  createImageBitmap?: (
    image: Blob,
    options?: ImageBitmapOptions,
  ) => Promise<ImageBitmap>;
  createImage?: () => HTMLImageElement;
  createCanvas: () => HTMLCanvasElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

export class ImagePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePreparationError";
  }
}

function getEnvironment(): ImagePreparationEnvironment {
  return {
    createImageBitmap:
      typeof globalThis.createImageBitmap === "function"
        ? globalThis.createImageBitmap.bind(globalThis)
        : undefined,
    createImage: () => new Image(),
    createCanvas: () => document.createElement("canvas"),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ImagePreparationError("Image preparation was cancelled.");
  }
}

function getScaledDimensions(
  width: number,
  height: number,
  maxDimension: number,
) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function getOutputName(file: File) {
  const baseName = file.name.replace(/\.[^/.]+$/, "") || "photo";
  return `${baseName}.jpg`;
}

function renderBlob(
  source: ImageSource,
  dimensions: { width: number; height: number },
  quality: number,
  environment: ImagePreparationEnvironment,
) {
  const canvas = environment.createCanvas();
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new ImagePreparationError("This browser cannot prepare images.");
  }

  context.drawImage(
    source as CanvasImageSource,
    0,
    0,
    dimensions.width,
    dimensions.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ImagePreparationError("Image compression failed."));
      },
      JPEG_TYPE,
      quality,
    );
  });
}

async function loadImage(
  file: File,
  environment: ImagePreparationEnvironment,
  signal?: AbortSignal,
): Promise<ImageSource> {
  throwIfAborted(signal);

  if (environment.createImageBitmap) {
    try {
      return await environment.createImageBitmap(file, {
        imageOrientation: "from-image",
      });
    } catch {
      // Some browsers expose createImageBitmap but cannot decode every image.
    }
  }

  if (!environment.createImage) {
    throw new ImagePreparationError("This browser cannot decode images.");
  }

  const image = environment.createImage();
  const objectUrl = environment.createObjectURL(file);
  try {
    return await new Promise<ImageSource>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new ImagePreparationError("The selected image is corrupt."));
      image.src = objectUrl;
    });
  } finally {
    environment.revokeObjectURL(objectUrl);
  }
}

async function encodePreparedImage(
  source: ImageSource,
  file: File,
  options: Required<
    Pick<
      ImagePreparationOptions,
      "maxDimension" | "targetSize" | "initialQuality" | "minQuality" | "minDimension"
    >
  >,
  environment: ImagePreparationEnvironment,
  signal?: AbortSignal,
) {
  let dimensions = getScaledDimensions(
    source.width,
    source.height,
    options.maxDimension,
  );
  let quality = options.initialQuality;
  let blob = await renderBlob(source, dimensions, quality, environment);

  while (blob.size > options.targetSize && quality > options.minQuality) {
    throwIfAborted(signal);
    quality = Math.max(options.minQuality, quality - 0.08);
    blob = await renderBlob(source, dimensions, quality, environment);
  }

  while (
    blob.size > options.targetSize &&
    Math.max(dimensions.width, dimensions.height) > options.minDimension
  ) {
    throwIfAborted(signal);
    const nextMaxDimension = Math.max(
      options.minDimension,
      Math.round(Math.max(dimensions.width, dimensions.height) * 0.8),
    );
    dimensions = getScaledDimensions(
      source.width,
      source.height,
      nextMaxDimension,
    );
    blob = await renderBlob(source, dimensions, quality, environment);
  }

  throwIfAborted(signal);
  return new File([blob], getOutputName(file), {
    type: JPEG_TYPE,
    lastModified: file.lastModified,
  });
}

export async function prepareImageForUpload(
  file: File,
  options: ImagePreparationOptions = {},
  environment: ImagePreparationEnvironment = getEnvironment(),
): Promise<File> {
  if (!SUPPORTED_TYPES.has(file.type.toLowerCase())) {
    throw new ImagePreparationError(
      "Only JPEG, PNG, and WebP images are supported.",
    );
  }

  const resolvedOptions = {
    maxDimension: options.maxDimension ?? DEFAULT_MAX_DIMENSION,
    targetSize: options.targetSize ?? DEFAULT_TARGET_SIZE,
    initialQuality: options.initialQuality ?? DEFAULT_INITIAL_QUALITY,
    minQuality: options.minQuality ?? DEFAULT_MIN_QUALITY,
    minDimension: options.minDimension ?? DEFAULT_MIN_DIMENSION,
  };
  if (
    resolvedOptions.maxDimension <= 0 ||
    resolvedOptions.targetSize <= 0 ||
    resolvedOptions.minQuality <= 0 ||
    resolvedOptions.initialQuality > 1 ||
    resolvedOptions.minQuality > resolvedOptions.initialQuality
  ) {
    throw new ImagePreparationError("Invalid image preparation options.");
  }

  let source: ImageSource | undefined;
  try {
    source = await loadImage(file, environment, options.signal);
    throwIfAborted(options.signal);
    return await encodePreparedImage(
      source,
      file,
      resolvedOptions,
      environment,
      options.signal,
    );
  } catch (error) {
    if (error instanceof ImagePreparationError) throw error;
    throw new ImagePreparationError(
      "The selected image could not be prepared for upload.",
    );
  } finally {
    source?.close?.();
  }
}

export const imagePreparationDefaults = {
  maxDimension: DEFAULT_MAX_DIMENSION,
  targetSize: DEFAULT_TARGET_SIZE,
};
