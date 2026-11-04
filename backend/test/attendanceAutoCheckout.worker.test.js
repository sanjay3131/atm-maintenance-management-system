import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startAttendanceAutoCheckoutWorker } from "../src/modules/attendance/attendanceAutoCheckout.worker.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for worker state");
};

const createHarness = (options = {}) => {
  const ticks = [];
  const logs = [];
  const clearedTimers = [];
  const signalSource = new EventEmitter();
  const database = {
    connection: { readyState: 1 },
    disconnectCalls: 0,
    async disconnect() {
      this.disconnectCalls += 1;
    },
  };
  const logger = {
    info: (...args) => logs.push(["info", ...args]),
    warn: (...args) => logs.push(["warn", ...args]),
    error: (...args) => logs.push(["error", ...args]),
  };

  return {
    ticks,
    logs,
    clearedTimers,
    signalSource,
    database,
    start: (runCycle) =>
      startAttendanceAutoCheckoutWorker({
        connect: async () => {},
        database,
        runCycle,
        setIntervalFn: (callback, interval) => {
          ticks.push({ callback, interval });
          return ticks.length;
        },
        clearIntervalFn: (timerId) => {
          clearedTimers.push(timerId);
          logs.push(["clearInterval", timerId]);
        },
        signalSource,
        logger,
        ...options,
      }),
  };
};

test("startup refuses to run when the existing connection did not connect", async () => {
  const harness = createHarness();
  harness.database.connection.readyState = 0;
  await assert.rejects(harness.start(async () => ({})), /did not connect/);
  assert.equal(harness.ticks.length, 0);
});

test("polling recovers from a cycle failure and schedules at one-minute intervals", async () => {
  const harness = createHarness();
  let cycleCount = 0;
  const worker = await harness.start(async () => {
    cycleCount += 1;
    if (cycleCount === 1) throw new Error("temporary failure");
    return { candidates: 2, updated: 2, raceLost: 0, failed: 0 };
  });
  assert.equal(harness.ticks[0].interval, 60_000);
  await worker.poll();
  harness.ticks[0].callback();
  await worker.poll();
  assert.equal(cycleCount, 2);
  assert.ok(harness.logs.some(([level, message]) =>
    level === "error" && message === "[AttendanceAutoCheckout] Poll failed"));
  assert.ok(harness.logs.some(([level, message, result]) =>
    level === "info" &&
    message === "[AttendanceAutoCheckout] Poll completed" &&
    result.updated === 2));
  await worker.stop();
});

test("overlapping polls are skipped until the active cycle finishes", async () => {
  const harness = createHarness();
  const pending = deferred();
  let cycleCount = 0;
  const worker = await harness.start(async () => {
    cycleCount += 1;
    if (cycleCount === 1) return pending.promise;
    return { candidates: 0, updated: 0, raceLost: 0, failed: 0 };
  });
  harness.ticks[0].callback();
  assert.equal(cycleCount, 1);
  assert.ok(harness.logs.some(([level, message]) =>
    level === "warn" &&
    message === "[AttendanceAutoCheckout] Skipping overlapping poll"));
  pending.resolve({ candidates: 1, updated: 1, raceLost: 0, failed: 0 });
  await worker.poll();
  harness.ticks[0].callback();
  await worker.poll();
  assert.equal(cycleCount, 2);
  await worker.stop();
});

test("shutdown clears polling, waits for the active cycle, and disconnects", async () => {
  const harness = createHarness();
  const pending = deferred();
  const worker = await harness.start(() => pending.promise);
  const stopPromise = worker.stop();
  assert.equal(harness.database.disconnectCalls, 0);
  assert.ok(harness.logs.some(([kind]) => kind === "clearInterval"));
  harness.ticks[0].callback();
  pending.resolve({ candidates: 0, updated: 0, raceLost: 0, failed: 0 });
  await stopPromise;
  assert.equal(harness.database.disconnectCalls, 1);
  assert.equal(harness.signalSource.listenerCount("SIGTERM"), 0);
  assert.equal(harness.signalSource.listenerCount("SIGINT"), 0);
  assert.equal(await worker.poll(), undefined);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`${signal} event stops polling and waits for the active cycle before disconnecting`, async () => {
    const harness = createHarness();
    const pending = deferred();
    let cycleCount = 0;
    await harness.start(async () => {
      cycleCount += 1;
      return pending.promise;
    });
    await waitFor(() => cycleCount === 1);

    harness.signalSource.emit(signal);
    await waitFor(() => harness.clearedTimers.length === 1);
    assert.equal(harness.database.disconnectCalls, 0);
    assert.equal(harness.clearedTimers[0], 1);

    harness.ticks[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cycleCount, 1);

    harness.signalSource.emit(signal);
    harness.signalSource.emit(signal === "SIGTERM" ? "SIGINT" : "SIGTERM");
    pending.resolve({ candidates: 1, updated: 1, raceLost: 0, failed: 0 });
    await waitFor(() => harness.database.disconnectCalls === 1);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(harness.database.disconnectCalls, 1);
    assert.equal(cycleCount, 1);
    assert.equal(harness.clearedTimers.length, 1);
  });
}

test("signal shutdown disconnects after the bounded wait when a cycle remains unresolved", async () => {
  const harness = createHarness({ shutdownTimeoutMs: 5 });
  let cycleCount = 0;
  await harness.start(async () => {
    cycleCount += 1;
    return new Promise(() => {});
  });
  await waitFor(() => cycleCount === 1);

  harness.signalSource.emit("SIGTERM");
  await waitFor(() => harness.database.disconnectCalls === 1);
  harness.ticks[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.database.disconnectCalls, 1);
  assert.equal(cycleCount, 1);
  assert.equal(harness.clearedTimers.length, 1);
  assert.ok(
    harness.logs.some(
      ([level, message]) =>
        level === "error" &&
        message === "[AttendanceAutoCheckout] Shutdown wait timed out",
    ),
  );
});
