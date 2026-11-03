import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import cloudinary from "../../config/cloudinary.js";
import JobPhotoUploadIntent from "./jobPhotoUploadIntent.model.js";
import JobPhotoUploadAsset from "./jobPhotoUploadAsset.model.js";
import JobPhoto from "./jobPhotos.model.js";
import Job from "../jobs/jobs.model.js";
import { JOB_STATUS } from "../../utils/jobStatus.js";

const LEASE_DURATION_MS = 10 * 60 * 1000;
const ASSET_CLAIM_LEASE_MS = 2 * 60 * 1000;
const ASSET_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const MAX_RECONCILIATION_BYTES = 5 * 1024 * 1024;
const RECONCILIATION_TIMEOUT_MS = 10_000;
const RECONCILIATION_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_SIGNATURES = [
  { mimeType: "image/jpeg", format: "jpg", matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { mimeType: "image/png", format: "png", matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mimeType: "image/webp", format: "webp", matches: (buffer) => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" },
];

const sameId = (left, right) => String(left) === String(right);
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const newTokenHash = () => hashToken(randomBytes(32));

export const detectImageMime = (buffer) => {
  const signature = MIME_SIGNATURES.find(({ matches }) => matches(buffer));
  if (!signature) {
    throw new ApiError(400, "The uploaded file is malformed or unsupported");
  }
  return signature;
};

export const calculateSha256 = (buffer) =>
  createHash("sha256").update(buffer).digest("hex");

export const validateUploadedFile = (file) => {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new ApiError(400, "The uploaded file is empty or invalid");
  }
  const detected = detectImageMime(file.buffer);
  const declaredMime = file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype;
  if (declaredMime !== detected.mimeType) {
    throw new ApiError(400, "The declared file type does not match its contents");
  }
  return {
    ...detected,
    contentSha256: calculateSha256(file.buffer),
    byteSize: file.buffer.length,
    originalName: file.originalname || "photo",
  };
};

export const buildPublicId = ({ jobId, photoType, intentId, ownerVersion }) =>
  `jobs/${jobId}/${photoType}/${intentId}/v${ownerVersion}`;

const immutableMetadataMatches = (intent, metadata) =>
  sameId(intent.jobId, metadata.jobId) &&
  intent.clientPhotoId === metadata.clientPhotoId &&
  intent.photoType === metadata.photoType &&
  intent.contentSha256 === metadata.contentSha256 &&
  intent.byteSize === metadata.byteSize &&
  intent.verifiedMimeType === metadata.verifiedMimeType &&
  intent.originalName === metadata.originalName;

const readIntent = (query) => query.select("+ownerTokenHash");

const currentIntentFilter = (intent) => ({
  _id: intent._id,
  currentOwnerUserId: intent.currentOwnerUserId,
  ownerVersion: intent.ownerVersion,
  ownerTokenHash: intent.ownerTokenHash,
  leaseExpiresAt: { $gt: new Date() },
});

const withMongoTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const getCurrentLiveIntent = async (intent, states) => {
  const filter = currentIntentFilter(intent);
  if (states) filter.state = { $in: states };
  const current = await readIntent(JobPhotoUploadIntent.findOne(filter));
  if (!current) {
    throw new ApiError(409, "The upload lease is no longer active");
  }
  return current;
};

export const reserveUploadIntent = async ({
  jobId,
  clientPhotoId,
  ownerUserId,
  photoType,
  metadata,
  isAdmin = false,
  transactionRunner = withMongoTransaction,
}) => {
  if (!UUID_PATTERN.test(clientPhotoId || "")) {
    throw new ApiError(400, "clientPhotoId must be a valid UUID");
  }
  if (
    typeof metadata?.originalName !== "string" ||
    metadata.originalName.trim().length === 0
  ) {
    throw new ApiError(400, "originalName must be a non-empty string");
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
  const tokenHash = newTokenHash();
  const originalName = metadata.originalName.trim();
  let intent = await readIntent(
    JobPhotoUploadIntent.findOne({ jobId, clientPhotoId }),
  );

  if (!intent) {
    try {
      intent = await JobPhotoUploadIntent.create({
        jobId,
        clientPhotoId,
        ownerUserId,
        currentOwnerUserId: ownerUserId,
        photoType,
        contentSha256: metadata.contentSha256,
        byteSize: metadata.byteSize,
        verifiedMimeType: metadata.mimeType,
        originalName,
        state: "reserved",
        ownerTokenHash: tokenHash,
        ownerVersion: 1,
        assetClaimFenceVersion: 0,
        leaseExpiresAt,
      });
      return { intent, replay: false, tokenHash };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      intent = await readIntent(
        JobPhotoUploadIntent.findOne({ jobId, clientPhotoId }),
      );
    }
  }

  if (!intent) {
    throw new ApiError(409, "The upload reservation could not be established");
  }
  const immutableMetadata = {
    jobId,
    clientPhotoId,
    photoType,
    contentSha256: metadata.contentSha256,
    byteSize: metadata.byteSize,
    verifiedMimeType: metadata.mimeType,
    originalName,
  };
  if (!immutableMetadataMatches(intent, immutableMetadata)) {
    throw new ApiError(409, "This clientPhotoId is already reserved for different photo data");
  }

  const active = intent.leaseExpiresAt && intent.leaseExpiresAt > now;
  if (active) {
    if (!sameId(intent.currentOwnerUserId, ownerUserId)) {
      throw new ApiError(409, "This photo upload is currently owned by another user");
    }
    return { intent, replay: true, tokenHash: intent.ownerTokenHash };
  }

  if (intent.state === "finalized") {
    return { intent, replay: true, tokenHash: intent.ownerTokenHash };
  }
  if (intent.state === "quarantined" && !isAdmin) {
    throw new ApiError(
      409,
      "This upload requires administrator reconciliation before it can continue",
    );
  }

  const updated = await transactionRunner(async (session) => {
    const takeoverNow = new Date();
    const takeoverLeaseExpiresAt = new Date(
      takeoverNow.getTime() + LEASE_DURATION_MS,
    );
    const query = JobPhotoUploadIntent.findOneAndUpdate(
      {
        _id: intent._id,
        ownerVersion: intent.ownerVersion,
        currentOwnerUserId: intent.currentOwnerUserId,
        ownerTokenHash: intent.ownerTokenHash,
        state: { $in: ["reserved", "uploading", "failed", "quarantined"] },
        leaseExpiresAt: { $lte: takeoverNow },
      },
      {
        $set: {
          currentOwnerUserId: ownerUserId,
          ownerTokenHash: tokenHash,
          leaseExpiresAt: takeoverLeaseExpiresAt,
          state: "reserved",
          failureCode: null,
          failureMessage: null,
          failedAt: null,
          quarantinedAt: null,
        },
        $inc: {
          ownerVersion: 1,
          assetClaimFenceVersion: 1,
        },
      },
      { new: true, runValidators: true },
    );
    query.session(session);
    return readIntent(query);
  });
  if (!updated) {
    throw new ApiError(409, "The upload reservation changed while it was being resumed");
  }
  return { intent: updated, replay: false, tokenHash };
};

const isNotFound = (error) =>
  error?.http_code === 404 ||
  error?.statusCode === 404 ||
  error?.error?.http_code === 404;

const resourceFor = async (publicId) => {
  try {
    return await cloudinary.api.resource(publicId, { resource_type: "image" });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

export const downloadAndVerify = async (
  resource,
  expectedSha256,
  expectedMimeType,
) => {
  if (!resource?.secure_url || typeof fetch !== "function") {
    throw new ApiError(502, "The Cloudinary asset could not be verified");
  }
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    RECONCILIATION_TIMEOUT_MS,
  );
  try {
    const response = await fetch(resource.secure_url, {
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new ApiError(502, "The Cloudinary asset could not be downloaded");
    }
    const contentType = response.headers?.get?.("content-type");
    if (
      contentType &&
      !RECONCILIATION_CONTENT_TYPES.has(contentType.split(";")[0].trim().toLowerCase())
    ) {
      throw new ApiError(502, "The Cloudinary asset returned an unsupported type");
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RECONCILIATION_BYTES
    ) {
      throw new ApiError(502, "The Cloudinary asset exceeds the allowed size");
    }

    if (!response.body?.getReader) {
      throw new ApiError(502, "The Cloudinary asset response is not streamable");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RECONCILIATION_BYTES) {
        await reader.cancel();
        throw new ApiError(502, "The Cloudinary asset exceeds the allowed size");
      }
      chunks.push(Buffer.from(value));
    }
    if (declaredLength > 0 && totalBytes !== declaredLength) {
      throw new ApiError(502, "The Cloudinary asset download was truncated");
    }
    const buffer = Buffer.concat(chunks, totalBytes);
    if (buffer.length === 0) {
      throw new ApiError(502, "The Cloudinary asset download was empty");
    }
    const detected = detectImageMime(buffer);
    const verifiedSha256 = calculateSha256(buffer);
    if (
      verifiedSha256 !== expectedSha256 ||
      detected.mimeType !== expectedMimeType
    ) {
      return {
        mismatch: true,
        verifiedSha256,
        detectedMimeType: detected.mimeType,
      };
    }
    return {
      verifiedSha256,
      verifiedMimeType: detected.mimeType,
      byteSize: buffer.length,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError(504, "The Cloudinary asset verification timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const uploadToCloudinary = (file, options) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(file.buffer);
  });

const upsertAsset = async (
  data,
  intent,
  transactionRunner = withMongoTransaction,
) => {
  if (!intent) {
    try {
      return await JobPhotoUploadAsset.findOneAndUpdate(
        { intentId: data.intentId, ownerVersion: data.ownerVersion },
        { $setOnInsert: data },
        { new: true, upsert: true, runValidators: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
      return JobPhotoUploadAsset.findOne({
        intentId: data.intentId,
        ownerVersion: data.ownerVersion,
      });
    }
  }

  const result = await runFencedAssetMutation({
    intent,
    assetStates: ["unknown"],
    assetFilter: () => ({
      intentId: data.intentId,
      ownerVersion: data.ownerVersion,
    }),
    assetUpdate: () => ({ $setOnInsert: data }),
    assetOptions: { upsert: true },
    transactionRunner,
  });
  return result.asset;
};

const uploadInProgressError = () => {
  const error = new ApiError(
    409,
    "The upload asset is being processed by another request",
  );
  error.uploadInProgress = true;
  return error;
};

const claimLostError = () => {
  const error = new ApiError(
    409,
    "The upload claim is no longer owned by this request",
  );
  error.claimLost = true;
  return error;
};

const claimTokenHashFor = (token) => hashToken(token);

export const claimAssetAttempt = async (
  asset,
  now = new Date(),
  intent = null,
  {
    isClaimLost = claimControlDefaults.isClaimLost,
    isStopped = claimControlDefaults.isStopped,
    transactionRunner = withMongoTransaction,
  } = {},
) => {
  if (
    asset.state === "uploading" &&
    asset.claimExpiresAt &&
    asset.claimExpiresAt > now
  ) {
    throw uploadInProgressError();
  }
  if (["uploaded", "verified", "adopted"].includes(asset.state)) return asset;

  const claimToken = randomBytes(32).toString("hex");
  const claimTokenHash = claimTokenHashFor(claimToken);
  const claimExpiresAt = new Date(now.getTime() + ASSET_CLAIM_LEASE_MS);
  const reclaimFilter =
    asset.state === "uploading"
      ? {
          $or: [
            { claimExpiresAt: { $lte: now } },
            { claimExpiresAt: null },
          ],
        }
      : {};
  if (intent) {
    const result = await runFencedAssetMutation({
      intent,
      assetStates: ["unknown", "uploading", "reconciliation_required"],
      assetFilter: (freshNow) => ({
        _id: asset._id,
        intentId: asset.intentId,
        ownerVersion: asset.ownerVersion,
        state: { $in: ["unknown", "uploading", "reconciliation_required"] },
        ...(asset.state === "uploading"
          ? {
              $or: [
                { claimExpiresAt: { $lte: freshNow } },
                { claimExpiresAt: null },
              ],
            }
          : {}),
      }),
      assetUpdate: (freshNow) => ({
        $set: {
          state: "uploading",
          claimStartedAt: freshNow,
          claimExpiresAt: new Date(freshNow.getTime() + ASSET_CLAIM_LEASE_MS),
          claimTokenHash,
          uploadedAt: asset.uploadedAt || freshNow,
          failureCode: null,
          failedAt: null,
        },
      }),
      isClaimLost,
      isStopped,
      transactionRunner,
    });
    const claimed = result.asset;
    const claimContext = {
      asset: claimed,
      claimToken,
      claimTokenHash,
      intentId: claimed.intentId,
      ownerVersion: claimed.ownerVersion,
    };
    Object.defineProperty(claimed, "claimContext", {
      value: claimContext,
      enumerable: false,
      configurable: true,
    });
    return claimed;
  }
  const claimed = await JobPhotoUploadAsset.findOneAndUpdate(
    {
      _id: asset._id,
      intentId: asset.intentId,
      ownerVersion: asset.ownerVersion,
      state: { $in: ["unknown", "uploading", "reconciliation_required"] },
      ...reclaimFilter,
    },
    {
      $set: {
        state: "uploading",
        claimStartedAt: now,
        claimExpiresAt,
        claimTokenHash,
        uploadedAt: asset.uploadedAt || now,
        failureCode: null,
        failedAt: null,
      },
    },
    { new: true, runValidators: true },
  );
  if (claimed) {
    const claimContext = {
      asset: claimed,
      claimToken,
      claimTokenHash,
      intentId: claimed.intentId,
      ownerVersion: claimed.ownerVersion,
    };
    Object.defineProperty(claimed, "claimContext", {
      value: claimContext,
      enumerable: false,
      configurable: true,
    });
    return claimed;
  }

  const current = await JobPhotoUploadAsset.findOne({
    _id: asset._id,
    intentId: asset.intentId,
    ownerVersion: asset.ownerVersion,
  });
  if (
    current?.state === "uploading" &&
    current.claimExpiresAt &&
    current.claimExpiresAt > now
  ) {
    throw uploadInProgressError();
  }
  throw new ApiError(409, "The upload asset changed while it was being claimed");
};

const assetClaimFilter = (claimContext, states, now = new Date()) => ({
  _id: claimContext.asset._id,
  intentId: claimContext.intentId,
  ownerVersion: claimContext.ownerVersion,
  claimTokenHash: claimContext.claimTokenHash,
  state: { $in: states },
  claimExpiresAt: { $gt: now },
});

const claimControlDefaults = {
  isClaimLost: () => false,
  isStopped: () => false,
};

const runFencedAssetMutation = async ({
  intent,
  claimContext,
  assetStates,
  assetFilter,
  assetUpdate,
  assetOptions = {},
  parentUpdate = {},
  isClaimLost = claimControlDefaults.isClaimLost,
  isStopped = claimControlDefaults.isStopped,
  transactionRunner = withMongoTransaction,
}) => {
  if (isClaimLost() || isStopped()) throw claimLostError();

  const result = await transactionRunner(async (session) => {
    if (isClaimLost() || isStopped()) throw claimLostError();
    const now = new Date();
    const parentQuery = JobPhotoUploadIntent.findOneAndUpdate(
      {
        _id: intent._id,
        currentOwnerUserId: intent.currentOwnerUserId,
        ownerVersion: intent.ownerVersion,
        ownerTokenHash: intent.ownerTokenHash,
        state: "uploading",
        leaseExpiresAt: { $gt: now },
      },
      {
        $inc: { assetClaimFenceVersion: 1 },
        ...parentUpdate,
      },
      { new: true, runValidators: true },
    );
    if (typeof parentQuery.session === "function") parentQuery.session(session);
    const parent = await readIntent(parentQuery);
    if (!parent) throw claimLostError();

    const filter = assetFilter
      ? assetFilter(now)
      : assetClaimFilter(claimContext, assetStates, now);
    const assetQuery = JobPhotoUploadAsset.findOneAndUpdate(
      filter,
      assetUpdate(now),
      { new: true, runValidators: true, ...assetOptions },
    );
    if (typeof assetQuery.session === "function") assetQuery.session(session);
    const asset = await assetQuery;
    if (!asset) throw claimLostError();
    return { parent, asset };
  });

  if (isClaimLost() || isStopped()) throw claimLostError();
  return result;
};

const runFencedParentMutation = async ({
  intent,
  states,
  update,
  isClaimLost = claimControlDefaults.isClaimLost,
  isStopped = claimControlDefaults.isStopped,
  transactionRunner = withMongoTransaction,
}) => {
  if (isClaimLost() || isStopped()) throw claimLostError();
  const result = await transactionRunner(async (session) => {
    if (isClaimLost() || isStopped()) throw claimLostError();
    const now = new Date();
    const query = JobPhotoUploadIntent.findOneAndUpdate(
      {
        _id: intent._id,
        currentOwnerUserId: intent.currentOwnerUserId,
        ownerVersion: intent.ownerVersion,
        ownerTokenHash: intent.ownerTokenHash,
        state: { $in: states },
        leaseExpiresAt: { $gt: now },
      },
      {
        $inc: { assetClaimFenceVersion: 1 },
        $set: typeof update === "function" ? update(now) : update,
      },
      { new: true, runValidators: true },
    );
    if (typeof query.session === "function") query.session(session);
    const parent = await readIntent(query);
    if (!parent) throw claimLostError();
    return parent;
  });
  if (isClaimLost() || isStopped()) throw claimLostError();
  return result;
};

export const renewAssetClaim = async (
  intent,
  claimContext,
  _unusedNow,
  {
    isClaimLost = () => false,
    isStopped = () => false,
    transactionRunner = withMongoTransaction,
  } = {},
) => {
  if (isClaimLost() || isStopped()) throw claimLostError();

  await runFencedAssetMutation({
    intent,
    claimContext,
    assetStates: ["uploading"],
    assetUpdate: (now) => ({
      $set: {
        claimStartedAt: now,
        claimExpiresAt: new Date(now.getTime() + ASSET_CLAIM_LEASE_MS),
      },
    }),
    isClaimLost,
    isStopped,
    transactionRunner,
  });
};

export const createClaimCoordinator = (
  intent,
  claimContext,
  {
    renew = renewAssetClaim,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    ownershipCheck = async () => {
      await getCurrentLiveIntent(intent, ["uploading"]);
      const ownershipQuery = JobPhotoUploadAsset.findOne(
        assetClaimFilter(claimContext, ["uploading", "verified"]),
      );
      return typeof ownershipQuery?.select === "function"
        ? ownershipQuery.select("_id")
        : ownershipQuery;
    },
  } = {},
) => {
  let stopped = false;
  let claimLost = false;
  let renewalPromise = null;
  const loseClaim = () => {
    claimLost = true;
  };
  const timer = setIntervalFn(() => {
    if (stopped || claimLost || renewalPromise) return;
    renewalPromise = renew(
      intent,
      claimContext,
      undefined,
      {
        isClaimLost: () => claimLost,
        isStopped: () => stopped,
      },
    )
      .catch(() => {
        claimLost = true;
      })
      .finally(() => {
        renewalPromise = null;
      });
  }, ASSET_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  const assertOwned = async () => {
    if (claimLost) throw claimLostError();
    try {
      const ownedByIntentAndAsset = await ownershipCheck();
      if (claimLost) throw claimLostError();
      if (!ownedByIntentAndAsset) throw claimLostError();
    } catch (error) {
      claimLost = true;
      if (error.claimLost) throw error;
      throw claimLostError();
    }
  };

  return {
    async beforeProviderOperation() {
      await assertOwned();
    },
    async afterProviderOperation() {
      await assertOwned();
    },
    hasLostClaim() {
      return claimLost;
    },
    isStopped() {
      return stopped;
    },
    loseClaim,
    async stop() {
      stopped = true;
      clearIntervalFn(timer);
      if (renewalPromise) await renewalPromise;
      if (claimLost) throw claimLostError();
      await assertOwned();
    },
  };
};

export const markAssetOrphaned = async (
  intent,
  claimContext,
  controls = {},
) => {
  await runFencedAssetMutation({
    intent,
    claimContext,
    assetStates: ["uploading", "verified"],
    assetUpdate: () => ({
      $set: {
        state: "orphaned",
        orphanedAt: new Date(),
        claimTokenHash: null,
        claimStartedAt: null,
        claimExpiresAt: null,
      },
    }),
    ...controls,
  });
};

export const markAssetReconciliationRequired = async (
  intent,
  claimContext,
  failureCode,
  controls = {},
) => {
  await runFencedAssetMutation({
    intent,
    claimContext,
    assetStates: ["uploading"],
    assetUpdate: () => ({
      $set: {
        state: "reconciliation_required",
        failureCode,
        failedAt: new Date(),
        claimTokenHash: null,
        claimStartedAt: null,
        claimExpiresAt: null,
      },
    }),
    ...controls,
  });
};

export const releaseAssetClaim = async (intent, claimContext, controls = {}) => {
  await runFencedAssetMutation({
    intent,
    claimContext,
    assetStates: ["verified"],
    assetUpdate: () => ({
      $set: {
        claimTokenHash: null,
        claimStartedAt: null,
        claimExpiresAt: null,
      },
    }),
    ...controls,
  });
};

export const markAssetVerified = async (
  intent,
  claimContext,
  verification,
  fields,
  controls = {},
) => {
  const result = await runFencedAssetMutation({
    intent,
    claimContext,
    assetStates: ["uploading", "uploaded", "verified"],
    assetUpdate: (now) => ({
      $set: {
        ...fields,
        cloudinaryBytes: verification.byteSize,
        verifiedSha256: verification.verifiedSha256,
        verifiedMimeType: verification.verifiedMimeType,
        state: "verified",
        verifiedAt: now,
      },
    }),
    ...controls,
  });
  return result.asset;
};

export const markIntentFailure = async (
  intent,
  failureCode,
  message,
  controls = {},
) => {
  return runFencedParentMutation({
    intent,
    states: ["reserved", "uploading"],
    update: () => ({
      state: "failed",
      failureCode,
      failureMessage: message,
      failedAt: new Date(),
    }),
    ...controls,
  });
};

export const uploadOrReconcileAsset = async ({
  intent,
  file,
  metadata,
  transactionRunner = withMongoTransaction,
}) => {
  if (!mongoose.isValidObjectId(intent._id)) {
    throw new ApiError(500, "The upload reservation is invalid");
  }
  const publicId = buildPublicId({
    jobId: intent.jobId,
    photoType: intent.photoType,
    intentId: intent._id,
    ownerVersion: intent.ownerVersion,
  });
  await getCurrentLiveIntent(intent, ["uploading"]);
  let asset = await JobPhotoUploadAsset.findOne({
    intentId: intent._id,
    ownerVersion: intent.ownerVersion,
  });
  if (!asset) {
    asset = await upsertAsset({
      intentId: intent._id,
      jobId: intent.jobId,
      clientPhotoId: intent.clientPhotoId,
      photoType: intent.photoType,
      ownerVersion: intent.ownerVersion,
      publicId,
      expectedSha256: metadata.contentSha256,
      state: "unknown",
      resourceType: "image",
    }, intent, transactionRunner);
  }
  const claimedAsset = await claimAssetAttempt(
    asset,
    new Date(),
    intent,
    { transactionRunner },
  );
  if (["uploaded", "verified", "adopted"].includes(claimedAsset?.state)) {
    return claimedAsset;
  }
  if (!claimedAsset?.claimContext) {
    throw new ApiError(409, "The upload asset is being processed by another request");
  }
  const claimContext = claimedAsset.claimContext;
  asset = claimedAsset;
  const coordinator = createClaimCoordinator(intent, claimContext);
  const coordinatorControls = {
    isClaimLost: () => coordinator.hasLostClaim(),
    isStopped: () => coordinator.isStopped(),
    transactionRunner,
  };
  try {
    await coordinator.beforeProviderOperation();
  } catch (error) {
    if (!error.claimLost) {
      await markAssetOrphaned(intent, claimContext, coordinatorControls);
    }
    throw error;
  }

  let resource;
  let verification;
  try {
    await coordinator.beforeProviderOperation();
    resource = await resourceFor(publicId);
    await coordinator.afterProviderOperation();
    verification = resource
      ? await (async () => {
          await coordinator.beforeProviderOperation();
          const result = await downloadAndVerify(
            resource,
            intent.contentSha256,
            intent.verifiedMimeType,
          );
          await coordinator.afterProviderOperation();
          return result;
        })()
      : null;
    if (verification?.mismatch) {
      await coordinator.beforeProviderOperation();
      await runFencedAssetMutation({
        intent,
        claimContext,
        assetStates: ["uploading"],
        assetUpdate: () => ({
          $set: {
            state: "quarantined",
            verifiedSha256: verification.verifiedSha256,
            failureCode: "asset_mismatch",
            failedAt: new Date(),
            claimTokenHash: null,
            claimStartedAt: null,
            claimExpiresAt: null,
          },
        }),
        ...coordinatorControls,
      });
      throw new ApiError(409, "The existing Cloudinary asset does not match this upload");
    }

    if (!verification) {
      await coordinator.beforeProviderOperation();
      const result = await uploadToCloudinary(file, {
        public_id: publicId,
        overwrite: false,
        resource_type: "image",
        format: metadata.format,
        tags: [`job_${intent.jobId}`, intent.photoType],
      }).catch(async (error) => {
        if (!error?.http_code || error.http_code !== 409) throw error;
        await coordinator.afterProviderOperation();
        await coordinator.beforeProviderOperation();
        resource = await resourceFor(publicId);
        await coordinator.afterProviderOperation();
        verification = resource
          ? await (async () => {
              await coordinator.beforeProviderOperation();
              const result = await downloadAndVerify(
                resource,
                intent.contentSha256,
                intent.verifiedMimeType,
              );
              await coordinator.afterProviderOperation();
              return result;
            })()
          : null;
        if (!verification || verification.mismatch) {
          throw new ApiError(409, "The existing Cloudinary asset could not be verified");
        }
        return null;
      });
      await coordinator.afterProviderOperation();
      if (result) {
        resource = result;
        await coordinator.beforeProviderOperation();
        verification = await downloadAndVerify(
          { secure_url: result.secure_url },
          intent.contentSha256,
          intent.verifiedMimeType,
        );
        await coordinator.afterProviderOperation();
        if (!verification || verification.mismatch) {
          throw new ApiError(502, "The uploaded Cloudinary asset could not be verified");
        }
      }
    }
  } catch (error) {
    if (!error.claimLost && !coordinator.hasLostClaim()) {
      try {
        await coordinator.beforeProviderOperation();
        await markAssetReconciliationRequired(
          intent,
          claimContext,
          error.statusCode === 504 ? "provider_timeout" : "verification_required",
          coordinatorControls,
        );
      } catch {
        // A lost claim is intentionally left for the next authorized reconciliation.
      }
    }
    const stopError = await coordinator.stop().catch((stopFailure) => stopFailure);
    if (stopError?.claimLost) throw stopError;
    throw error;
  }

  const updated = await markAssetVerified(
    intent,
    claimContext,
    verification,
    {
      publicId,
      assetId: resource?.asset_id || resource?.assetId || null,
      format: resource?.format || metadata.format,
      secureUrl: resource?.secure_url || resource?.secureUrl || null,
      uploadedAt: asset.uploadedAt,
    },
    coordinatorControls,
  );
  await coordinator.stop();
  updated.claimContext = claimContext;
  return updated;
};

export const completeUploadIntent = async (intent, asset) => {
  const claimContext = asset.claimContext;
  const uploadedAt = new Date();
  if (!claimContext) {
    return runFencedParentMutation({
      intent,
      states: ["uploading"],
      update: {
        state: "uploaded",
        uploadedAt,
      },
    });
  }

  try {
    const result = await runFencedAssetMutation({
      intent,
      claimContext,
      assetStates: ["verified"],
      parentUpdate: {
        $set: { state: "uploaded", uploadedAt },
      },
      assetUpdate: () => ({
        $set: {
          claimTokenHash: null,
          claimStartedAt: null,
          claimExpiresAt: null,
        },
      }),
    });
    return result.parent;
  } catch (error) {
    try {
      await getCurrentLiveIntent(intent, ["uploading"]);
      await markAssetOrphaned(intent, claimContext);
    } catch {
      // The parent or claim fence has already stopped this request.
    }
    throw error;
  }
};

const isValidDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

const asObjectId = (value, fieldName) => {
  if (!mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${fieldName} is invalid`);
  }
  return new mongoose.Types.ObjectId(value);
};

const withSession = (query, session) => {
  if (typeof query?.session === "function") query.session(session);
  return query;
};

const readFinalizedUploadResult = async (intent, session) => {
  if (
    intent.state !== "finalized" ||
    !intent.finalizedJobPhotoId ||
    !intent.finalizedAssetId ||
    !intent.finalizedOwnerVersion
  ) {
    throw new ApiError(409, "The upload finalization record is incomplete");
  }

  const jobPhoto = await withSession(
    JobPhoto.findOne({
      _id: intent.finalizedJobPhotoId,
      jobId: intent.jobId,
      uploadIntentId: intent._id,
    }),
    session,
  );
  if (!jobPhoto) {
    throw new ApiError(409, "The finalized JobPhoto record is missing");
  }

  const job = await withSession(Job.findById(intent.jobId), session);
  if (!job) throw new ApiError(404, "Job not found");
  const photoIds =
    intent.photoType === "before" ? job.beforePhotos || [] : job.afterPhotos || [];
  if (!photoIds.some((photoId) => sameId(photoId, jobPhoto._id))) {
    throw new ApiError(409, "The finalized JobPhoto is not linked to the Job");
  }

  const asset = await withSession(
    JobPhotoUploadAsset.findOne({
      _id: intent.finalizedAssetId,
      intentId: intent._id,
      jobId: intent.jobId,
      ownerVersion: intent.finalizedOwnerVersion,
      adoptedJobPhotoId: jobPhoto._id,
      state: "adopted",
    }),
    session,
  );
  if (!asset) {
    throw new ApiError(409, "The finalized upload asset is not adopted");
  }

  return { intent, asset, jobPhoto };
};

const authorizedForFinalization = (job, intent, userId, userType) => {
  const isAdmin = ["admin", "superAdmin"].includes(userType);
  if (isAdmin) return true;
  return (
    sameId(job.assignedEmployeeId, userId) &&
    sameId(intent.currentOwnerUserId, userId)
  );
};

const assertFinalizationStatus = (job, intent) => {
  if (
    [
      JOB_STATUS.ASSIGNED,
      JOB_STATUS.ACCEPTED,
      JOB_STATUS.IN_PROGRESS,
      JOB_STATUS.ON_HOLD,
    ].includes(job.status)
  ) {
    return;
  }
  if (job.status === JOB_STATUS.COMPLETED) {
    if (!isValidDate(job.completedAt) || !isValidDate(intent.uploadedAt)) {
      throw new ApiError(
        409,
        "Completed Job recovery requires valid upload and completion timestamps",
      );
    }
    if (!(intent.uploadedAt < job.completedAt)) {
      throw new ApiError(
        409,
        "The upload did not complete before the Job was completed",
      );
    }
    return;
  }
  throw new ApiError(
    400,
    `Cannot finalize a photo for Job with status: ${job.status}`,
  );
};

const finalizationRevisionFilter = (jobId, revision) => ({
  _id: jobId,
  $or: [
    { photoFinalizationRevision: revision },
    ...(revision === 0
      ? [{ photoFinalizationRevision: { $exists: false } }]
      : []),
  ],
});

const validJobPhotoCount = async (job, photoType, session) => {
  const typeIds = photoType === "before" ? job.beforePhotos || [] : job.afterPhotos || [];
  const allIds = [...(job.beforePhotos || []), ...(job.afterPhotos || [])];
  const [typeCount, totalCount] = await Promise.all([
    withSession(
      JobPhoto.countDocuments({
        _id: { $in: typeIds },
        jobId: job._id,
        photoType,
        isExpired: false,
        url: { $type: "string", $ne: "" },
      }),
      session,
    ),
    withSession(
      JobPhoto.countDocuments({
        _id: { $in: allIds },
        jobId: job._id,
        isExpired: false,
        url: { $type: "string", $ne: "" },
      }),
      session,
    ),
  ]);
  return { typeCount, totalCount };
};

const createFinalizationPhoto = async ({
  intent,
  asset,
  job,
  session,
}) => {
  if (!asset.secureUrl) {
    throw new ApiError(409, "The verified upload asset has no secure URL");
  }
  const records = await JobPhoto.create(
    [
      {
        jobId: job._id,
        atmId: job.atmId,
        uploadIntentId: intent._id,
        photoType: intent.photoType,
        publicId: asset.publicId,
        url: asset.secureUrl,
        originalName: intent.originalName,
        size: intent.byteSize,
        mimeType: intent.verifiedMimeType,
        uploadedBy: intent.currentOwnerUserId,
        uploadedAt: intent.uploadedAt,
      },
    ],
    { session },
  );
  return records[0];
};

const finalizeUploadTransaction = async ({
  jobId,
  uploadIntentId,
  userId,
  userType,
  transactionRunner,
}) =>
  transactionRunner(async (session) => {
    const intent = await readIntent(
      withSession(
        JobPhotoUploadIntent.findById(uploadIntentId),
        session,
      ),
    );
    if (!intent || !sameId(intent.jobId, jobId)) {
      throw new ApiError(404, "Upload intent not found");
    }
    const job = await withSession(Job.findById(jobId), session);
    if (!job || job.isDeleted) throw new ApiError(404, "Job not found");
    if (!authorizedForFinalization(job, intent, userId, userType)) {
      throw new ApiError(403, "You are not authorized to finalize this Job photo");
    }
    if (intent.state === "finalized") {
      return readFinalizedUploadResult(intent, session);
    }
    if (intent.state !== "uploaded") {
      throw new ApiError(409, "The upload is not ready for finalization");
    }
    if (!isValidDate(intent.uploadedAt)) {
      throw new ApiError(409, "The uploaded intent has no valid uploadedAt timestamp");
    }

    assertFinalizationStatus(job, intent);

    const asset = await withSession(
      JobPhotoUploadAsset.findOne({
        intentId: intent._id,
        jobId: job._id,
        ownerVersion: intent.ownerVersion,
      }),
      session,
    );
    if (!asset) throw new ApiError(409, "The upload asset is missing");
    if (
      !sameId(asset.intentId, intent._id) ||
      !sameId(asset.jobId, job._id) ||
      asset.ownerVersion !== intent.ownerVersion ||
      asset.clientPhotoId !== intent.clientPhotoId ||
      asset.photoType !== intent.photoType ||
      asset.verifiedSha256 !== intent.contentSha256 ||
      asset.verifiedMimeType !== intent.verifiedMimeType ||
      asset.cloudinaryBytes !== intent.byteSize ||
      asset.publicId !==
        buildPublicId({
          jobId: intent.jobId,
          photoType: intent.photoType,
          intentId: intent._id,
          ownerVersion: intent.ownerVersion,
        })
    ) {
      throw new ApiError(409, "The upload asset does not match the upload intent");
    }
    if (asset.state !== "verified" && asset.state !== "adopted") {
      throw new ApiError(409, "The upload asset is not verified");
    }

    let jobPhoto = await withSession(
      JobPhoto.findOne({
        uploadIntentId: intent._id,
        jobId: job._id,
      }),
      session,
    );
    if (jobPhoto && !sameId(jobPhoto.publicId, asset.publicId)) {
      throw new ApiError(409, "A conflicting JobPhoto exists for this upload intent");
    }
    const arrayField = intent.photoType === "before" ? "beforePhotos" : "afterPhotos";
    const alreadyLinked = (job[arrayField] || []).some((photoId) =>
      sameId(photoId, jobPhoto?._id),
    );
    if (!alreadyLinked) {
      const { typeCount, totalCount } = await validJobPhotoCount(
        job,
        intent.photoType,
        session,
      );
      if (typeCount >= 3 || totalCount >= 6) {
        throw new ApiError(409, "The Job photo limit has been reached");
      }
      if (!jobPhoto) {
        jobPhoto = await createFinalizationPhoto({ intent, asset, job, session });
      }
    }

    if (
      asset.state === "adopted" &&
      (!asset.adoptedJobPhotoId ||
        !sameId(asset.adoptedJobPhotoId, jobPhoto._id))
    ) {
      throw new ApiError(409, "The upload asset is already adopted by another JobPhoto");
    }
    if (asset.state === "verified") {
      const adopted = await withSession(
        JobPhotoUploadAsset.findOneAndUpdate(
          {
            _id: asset._id,
            intentId: intent._id,
            jobId: job._id,
            ownerVersion: intent.ownerVersion,
            state: "verified",
            $or: [
              { adoptedJobPhotoId: null },
              { adoptedJobPhotoId: { $exists: false } },
            ],
          },
          {
            $set: {
              state: "adopted",
              adoptedJobPhotoId: jobPhoto._id,
              adoptedAt: new Date(),
            },
          },
          { new: true, runValidators: true },
        ),
        session,
      );
      if (!adopted) {
        throw new ApiError(409, "The upload asset changed during finalization");
      }
    }

    const revision = Number.isInteger(job.photoFinalizationRevision)
      ? job.photoFinalizationRevision
      : 0;
    const jobUpdate = alreadyLinked
      ? { matchedCount: 1 }
      : await withSession(
          Job.updateOne(
            {
              ...finalizationRevisionFilter(job._id, revision),
              [arrayField]: { $ne: jobPhoto._id },
            },
            {
              $addToSet: { [arrayField]: jobPhoto._id },
              $inc: { photoFinalizationRevision: 1 },
            },
            { runValidators: true },
          ),
          session,
        );
    if (jobUpdate.matchedCount !== 1) {
      throw new ApiError(409, "The Job changed while finalizing the photo");
    }

    const finalizedAt = new Date();
    const finalizedIntent = await withSession(
      JobPhotoUploadIntent.findOneAndUpdate(
        {
          _id: intent._id,
          jobId: job._id,
          currentOwnerUserId: intent.currentOwnerUserId,
          ownerVersion: intent.ownerVersion,
          ownerTokenHash: intent.ownerTokenHash,
          state: "uploaded",
        },
        {
          $set: {
            state: "finalized",
            finalizedJobPhotoId: jobPhoto._id,
            finalizedAssetId: asset._id,
            finalizedOwnerVersion: intent.ownerVersion,
            finalizedAt,
          },
        },
        { new: true, runValidators: true },
      ),
      session,
    );
    if (!finalizedIntent) {
      throw new ApiError(409, "The upload changed during finalization");
    }

    return { intent: finalizedIntent, asset, jobPhoto };
  });

const hasErrorLabel = (error, label) =>
  (typeof error?.hasErrorLabel === "function" &&
    error.hasErrorLabel(label)) ||
  error?.errorLabels?.includes?.(label) === true;

export const finalizeUploadIntent = async ({
  jobId,
  uploadIntentId,
  userId,
  userType,
  transactionRunner = withMongoTransaction,
}) => {
  const normalizedJobId = asObjectId(jobId, "jobId");
  const normalizedIntentId = asObjectId(uploadIntentId, "uploadIntentId");
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await finalizeUploadTransaction({
        jobId: normalizedJobId,
        uploadIntentId: normalizedIntentId,
        userId,
        userType,
        transactionRunner,
      });
    } catch (error) {
      if (error?.code === 11000) {
        const current = await readIntent(
          JobPhotoUploadIntent.findById(normalizedIntentId),
        );
        if (current?.state === "finalized") {
          return readFinalizedUploadResult(current);
        }
        if (attempt === maxAttempts) {
          throw new ApiError(
            409,
            "A conflicting finalization record already exists",
          );
        }
        continue;
      }
      if (
        !hasErrorLabel(error, "TransientTransactionError") &&
        !hasErrorLabel(error, "UnknownTransactionCommitResult")
      ) {
        throw error;
      }

      const current = await readIntent(
        JobPhotoUploadIntent.findById(normalizedIntentId),
      );
      if (current?.state === "finalized") {
        return readFinalizedUploadResult(current);
      }
      if (attempt === maxAttempts) {
        throw new ApiError(
          503,
          "Photo finalization outcome is unresolved; please retry",
        );
      }
    }
  }
};

export const getFinalizedUploadResult = async (intent) =>
  readFinalizedUploadResult(intent);

export const assertLiveIntentLease = async (intent) => {
  return getCurrentLiveIntent(intent, [
    "reserved",
    "uploading",
    "failed",
  ]);
};

export const setIntentState = async (intent, state) => {
  try {
    return await runFencedParentMutation({
      intent,
      states: ["reserved", "uploading", "failed"],
      update: { state },
    });
  } catch (error) {
    if (error.claimLost) {
      throw new ApiError(
        409,
        "The upload lease changed while the file was being processed",
      );
    }
    throw error;
  }
};

export const LEASE_DURATION = LEASE_DURATION_MS;
