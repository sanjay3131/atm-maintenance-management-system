import assert from "node:assert/strict";
import test from "node:test";
import { createClaimCoordinator } from "../src/modules/jobPhotos/jobPhotoUpload.service.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const coordinatorHarness = ({
  renew = async () => {},
  ownershipCheck = async () => true,
} = {}) => {
  let heartbeat;
  let cleared = 0;
  const coordinator = createClaimCoordinator(
    { _id: "intent-1" },
    {
      asset: { _id: "asset-1" },
      intentId: "intent-1",
      ownerVersion: 1,
      claimTokenHash: "a".repeat(64),
    },
    {
      renew,
      ownershipCheck,
      setIntervalFn: (callback) => {
        heartbeat = callback;
        return "heartbeat";
      },
      clearIntervalFn: () => {
        cleared += 1;
      },
    },
  );
  return {
    coordinator,
    tick: () => heartbeat(),
    get cleared() {
      return cleared;
    },
  };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

test("late successful heartbeat cannot revive terminal claim loss", async () => {
  const renewal = deferred();
  const harness = coordinatorHarness({
    renew: () => renewal.promise,
  });

  harness.tick();
  harness.coordinator.loseClaim();
  renewal.resolve();
  await flush();

  assert.equal(harness.coordinator.hasLostClaim(), true);
  await assert.rejects(
    harness.coordinator.beforeProviderOperation(),
    (error) => error.claimLost === true,
  );
  assert.equal(harness.coordinator.hasLostClaim(), true);
});

test("shutdown waits for a pending heartbeat and prevents later scheduling", async () => {
  const renewal = deferred();
  const harness = coordinatorHarness({
    renew: () => renewal.promise,
  });

  harness.tick();
  let stopped = false;
  const shutdown = harness.coordinator.stop().then(() => {
    stopped = true;
  });
  await flush();
  assert.equal(stopped, false);

  renewal.resolve();
  await shutdown;
  assert.equal(stopped, true);
  assert.equal(harness.cleared, 1);

  harness.tick();
  await flush();
  assert.equal(harness.coordinator.hasLostClaim(), false);
});

test("parent intent takeover after renewal permanently loses the claim", async () => {
  const renewal = deferred();
  let ownershipChecks = 0;
  const ownershipCheck = async () => {
    ownershipChecks += 1;
    return ownershipChecks < 2;
  };
  const harness = coordinatorHarness({
    renew: async () => {
      assert.equal(await ownershipCheck(), true);
      await renewal.promise;
      if (!(await ownershipCheck())) {
        throw new Error("parent intent was taken over");
      }
    },
    ownershipCheck,
  });

  harness.tick();
  renewal.resolve();
  await flush();

  assert.equal(ownershipChecks, 2);
  assert.equal(harness.coordinator.hasLostClaim(), true);
  await assert.rejects(
    harness.coordinator.beforeProviderOperation(),
    (error) => error.claimLost === true,
  );
});

test("failed heartbeat blocks provider work and remains terminal", async () => {
  const renewal = deferred();
  const harness = coordinatorHarness({
    renew: () => renewal.promise,
  });

  harness.tick();
  renewal.reject(new Error("lost ownership"));
  await flush();

  assert.equal(harness.coordinator.hasLostClaim(), true);
  await assert.rejects(
    harness.coordinator.beforeProviderOperation(),
    (error) => error.claimLost === true,
  );
  assert.equal(harness.coordinator.hasLostClaim(), true);
});

test("provider completion after claim loss cannot trigger stale follow-up work", async () => {
  const harness = coordinatorHarness();
  await harness.coordinator.beforeProviderOperation();

  const provider = deferred();
  let staleFollowUpCount = 0;
  const operation = provider.promise.then(async () => {
    harness.coordinator.loseClaim();
    await assert.rejects(
      harness.coordinator.afterProviderOperation(),
      (error) => error.claimLost === true,
    );
    if (!harness.coordinator.hasLostClaim()) staleFollowUpCount += 1;
  });

  provider.resolve({ secure_url: "https://cloudinary.invalid/asset" });
  await operation;
  assert.equal(staleFollowUpCount, 0);
});
