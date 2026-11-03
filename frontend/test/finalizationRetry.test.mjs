import assert from "node:assert/strict";
import test from "node:test";
import { createFinalizationRetryCoordinator } from "../src/features/jobs/utils/finalizationRetry.ts";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("retries the same intent after failure and clears it after success", async () => {
  const coordinator = createFinalizationRetryCoordinator();
  const calls = [];
  let attempt = 0;
  const finalize = async (uploadIntentId) => {
    calls.push(uploadIntentId);
    attempt += 1;
    if (attempt === 1) throw new Error("temporary failure");
  };

  assert.equal(await coordinator.run("intent-1", finalize), false);
  assert.equal(coordinator.hasAttempted("intent-1"), true);
  assert.equal(await coordinator.retry("intent-1", finalize), true);
  assert.deepEqual(calls, ["intent-1", "intent-1"]);
  assert.equal(coordinator.hasAttempted("intent-1"), false);
  assert.equal(coordinator.isLocked(), false);
});

test("retry orchestration never invokes photo upload", async () => {
  const coordinator = createFinalizationRetryCoordinator();
  const uploads = [];
  const finalizations = [];

  await coordinator.run("intent-2", async (uploadIntentId) => {
    finalizations.push(uploadIntentId);
  });

  assert.deepEqual(finalizations, ["intent-2"]);
  assert.deepEqual(uploads, []);
});

test("same-intent duplicate invocation is rejected while pending", async () => {
  const coordinator = createFinalizationRetryCoordinator();
  const pending = deferred();
  let calls = 0;
  const finalize = async () => {
    calls += 1;
    await pending.promise;
  };

  const first = coordinator.run("intent-3", finalize);
  const duplicate = coordinator.retry("intent-3", finalize);

  assert.equal(await duplicate, false);
  assert.equal(calls, 1);
  pending.resolve();
  assert.equal(await first, true);
  assert.equal(coordinator.isLocked(), false);
});

test("different intents remain serialized through the global lock", async () => {
  const coordinator = createFinalizationRetryCoordinator();
  const pending = deferred();
  let calls = 0;

  const first = coordinator.run("intent-4", async () => {
    calls += 1;
    await pending.promise;
  });
  const second = coordinator.run("intent-5", async () => {
    calls += 1;
  });

  assert.equal(await second, false);
  assert.equal(calls, 1);
  pending.resolve();
  assert.equal(await first, true);
  assert.equal(coordinator.isLocked(), false);
  assert.equal(await coordinator.retry("intent-5", async () => {}), true);
});

test("failed requests release the lock and keep the intent retryable", async () => {
  const coordinator = createFinalizationRetryCoordinator();
  const result = await coordinator.run("intent-6", async () => {
    throw new Error("failed");
  });

  assert.equal(result, false);
  assert.equal(coordinator.isLocked(), false);
  assert.equal(coordinator.hasAttempted("intent-6"), true);
  assert.equal(await coordinator.retry("intent-6", async () => {}), true);
  assert.equal(coordinator.hasAttempted("intent-6"), false);
});
