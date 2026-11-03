import test from "node:test";
import assert from "node:assert/strict";
import {
  ImagePreparationError,
  prepareImageForUpload,
} from "../src/features/jobs/utils/imagePreparation.ts";

const makeFile = (type, name = "photo.jpg", size = 100) =>
  new File([new Uint8Array(size)], name, {
    type,
    lastModified: 123,
  });

const makeEnvironment = ({
  width = 1000,
  height = 800,
  blobSize = ({ width: canvasWidth, height: canvasHeight, quality }) =>
    Math.round(canvasWidth * canvasHeight * quality * 0.5),
  failBlob = false,
} = {}) => {
  const canvases = [];
  const sources = [];
  return {
    canvases,
    sources,
    createImageBitmap: async () => {
      const source = {
        width,
        height,
        closeCalls: 0,
        close() {
          this.closeCalls += 1;
        },
      };
      sources.push(source);
      return source;
    },
    createCanvas: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob(callback, _type, quality) {
          if (failBlob) {
            callback(null);
            return;
          }
          const size = blobSize({
            width: canvas.width,
            height: canvas.height,
            quality,
          });
          callback(new Blob([new Uint8Array(size)], { type: "image/jpeg" }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
    createObjectURL: () => "blob:source",
    revokeObjectURL: () => {},
  };
};

test("keeps small images within the configured maximum dimension", async () => {
  const environment = makeEnvironment({ width: 800, height: 600 });
  const result = await prepareImageForUpload(
    makeFile("image/jpeg"),
    { maxDimension: 1920, targetSize: 1_500_000 },
    environment,
  );

  assert.equal(result.type, "image/jpeg");
  assert.equal(result.name, "photo.jpg");
  assert.deepEqual(
    [environment.canvases[0].width, environment.canvases[0].height],
    [800, 600],
  );
  assert.equal(environment.sources[0].closeCalls, 1);
});

test("resizes large images while preserving aspect ratio", async () => {
  const environment = makeEnvironment({ width: 4000, height: 2000 });
  await prepareImageForUpload(
    makeFile("image/jpeg"),
    { maxDimension: 1920, targetSize: 1_500_000 },
    environment,
  );

  assert.deepEqual(
    [environment.canvases[0].width, environment.canvases[0].height],
    [1920, 960],
  );
});

test("reduces dimensions when quality alone cannot reach the target size", async () => {
  const environment = makeEnvironment({
    width: 4000,
    height: 3000,
    blobSize: ({ width, height }) => width * height,
  });
  const result = await prepareImageForUpload(
    makeFile("image/png", "diagram.png"),
    { maxDimension: 1920, targetSize: 400_000, minDimension: 640 },
    environment,
  );

  assert.ok(result.size <= 400_000);
  assert.equal(result.type, "image/jpeg");
  assert.ok(environment.canvases.at(-1).width < 1920);
  assert.equal(environment.sources[0].closeCalls, 1);
});

test("rejects unsupported formats before decoding", async () => {
  await assert.rejects(
    prepareImageForUpload(
      makeFile("application/pdf", "photo.pdf"),
      {},
      makeEnvironment(),
    ),
    (error) =>
      error instanceof ImagePreparationError &&
      /JPEG, PNG, and WebP/.test(error.message),
  );
});

test("reports compression failures and still releases the source", async () => {
  const environment = makeEnvironment({ failBlob: true });

  await assert.rejects(
    prepareImageForUpload(makeFile("image/webp"), {}, environment),
    (error) =>
      error instanceof ImagePreparationError &&
      /compression failed/.test(error.message),
  );
  assert.equal(environment.sources[0].closeCalls, 1);
});

test("supports repeated preparation without retaining previous resources", async () => {
  const environment = makeEnvironment({ width: 1200, height: 900 });
  const first = await prepareImageForUpload(
    makeFile("image/jpeg", "first.jpg"),
    {},
    environment,
  );
  const second = await prepareImageForUpload(
    makeFile("image/jpeg", "second.jpg"),
    {},
    environment,
  );

  assert.equal(first.name, "first.jpg");
  assert.equal(second.name, "second.jpg");
  assert.deepEqual(
    environment.sources.map((source) => source.closeCalls),
    [1, 1],
  );
});

test("cancels preparation through AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    prepareImageForUpload(
      makeFile("image/jpeg"),
      { signal: controller.signal },
      makeEnvironment(),
    ),
    (error) =>
      error instanceof ImagePreparationError &&
      /cancelled/.test(error.message),
  );
});
