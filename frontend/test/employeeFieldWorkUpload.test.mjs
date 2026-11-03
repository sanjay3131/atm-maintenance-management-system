import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panelPath = new URL(
  "../src/features/jobs/components/EmployeeFieldWorkPanel.tsx",
  import.meta.url,
);
const servicePath = new URL(
  "../src/features/jobs/services/jobs.service.ts",
  import.meta.url,
);

const [panel, service] = await Promise.all([
  readFile(panelPath, "utf8"),
  readFile(servicePath, "utf8"),
]);

test("employee photo upload sends one pending photo per request", () => {
  assert.match(panel, /files: \[pendingPhoto\.file\]/);
  assert.match(service, /files\.forEach\(\(file\) => formData\.append\("photos"/);
  assert.match(service, /formData\.append\("clientPhotoId", clientPhotoId\)/);
  assert.match(
    panel,
    /clientPhotoId: pendingPhoto\.clientPhotoId/,
  );
});

test("prepared photos receive stable client identities separate from fingerprints", () => {
  assert.match(panel, /interface PendingPhoto \{[\s\S]*clientPhotoId: string;/);
  assert.match(panel, /clientPhotoId: crypto\.randomUUID\(\)/);
  assert.match(
    panel,
    /id = getFileId\(preparedFile\)[\s\S]*clientPhotoId: crypto\.randomUUID\(\)/,
  );
  assert.doesNotMatch(panel, /clientPhotoId: id/);
});

test("retries reuse the pending photo client identity and replacements create a new one", () => {
  assert.match(
    panel,
    /clientPhotoId: pendingPhoto\.clientPhotoId/,
  );
  assert.match(
    panel,
    /photo\.id === target\.id \? accepted\[0\] : photo/,
  );
  assert.match(panel, /clientPhotoId: crypto\.randomUUID\(\)/);
});

test("employee photo upload processes pending photos sequentially", () => {
  assert.match(panel, /while \(true\) \{/);
  assert.match(
    panel,
    /await uploadMutation\.mutateAsync\(\{[\s\S]*?files: \[pendingPhoto\.file\]/,
  );
  assert.match(panel, /finalizationPending !== true/);
  assert.match(panel, /finalizePendingIntent\(/);
});

test("successful upload automatically finalizes and preserves retryable pending state", () => {
  assert.match(panel, /pendingUploadStatuses\[photo\.id\] !== "finalization-pending"/);
  assert.match(panel, /"finalization-pending"/);
  assert.match(panel, /useFinalizeJobPhoto/);
  assert.match(panel, /finalizationPending !== false/);
});

test("progress is associated with the active pending photo ID", () => {
  assert.match(panel, /photoId: pendingPhoto\.id/);
  assert.match(panel, /current\?\.photoId === pendingPhoto\.id/);
  assert.match(panel, /activeUpload\?\.photoId === photo\.id/);
});

test("uncertain upload outcomes require verification and do not retry automatically", () => {
  assert.match(panel, /pendingUploadStatuses\[photo\.id\]/);
  assert.match(panel, /ambiguous \? "verification" : "failed"/);
  assert.match(panel, /Photo upload response was not confirmed/);
  assert.match(panel, /pendingUploadStatuses\[photo\.id\] !== "verification"/);
});

test("pending upload intents are hydrated idempotently after remount", () => {
  assert.match(service, /getPendingJobPhotoUploads/);
  assert.match(service, /\/photos\/job\/\$\{jobId\}\/pending/);
  assert.match(panel, /setPendingIntentRecords/);
  assert.match(panel, /new Map\(records\.map\(\(record\) => \[record\.clientPhotoId, record\]\)\)/);
  assert.match(panel, /Some uploaded photos are awaiting finalization/);
  assert.match(panel, /createFinalizationRetryCoordinator/);
  assert.match(panel, /record\.state === "uploaded"/);
});

test("pending finalization can be retried without remounting or re-uploading", () => {
  assert.match(panel, /retryPendingFinalization = useCallback/);
  assert.match(
    panel,
    /void finalizePendingIntent\(record\.uploadIntentId, undefined, undefined, true\)/,
  );
  assert.match(panel, /record\.state === "uploaded"[\s\S]*t\("Retry"\)/);
  assert.match(panel, /coordinator\.retry\(uploadIntentId, attempt\)/);
});

test("repeated finalization retry clicks remain serialized", () => {
  assert.match(
    panel,
    /record\.state !== "uploaded"[\s\S]*finalizationCoordinatorRef\.current\.isLocked\(\)/,
  );
  assert.match(panel, /disabled=\{finalizingIntentId !== null\}/);
  assert.match(panel, /coordinator\.isLocked\(\)/);
});

test("Before and After uploads share the same independent photo-type flow", () => {
  assert.match(panel, /const photoTypes: Array/);
  assert.match(panel, /\{ type: "before", title: "Before photos" \}/);
  assert.match(panel, /\{ type: "after", title: "After photos" \}/);
  assert.match(panel, /REQUIRED_PHOTOS_PER_TYPE/);
});
