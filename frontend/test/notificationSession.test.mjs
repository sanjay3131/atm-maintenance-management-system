import test from "node:test";
import assert from "node:assert/strict";
import { NotificationSession } from "../src/features/notifications/notification-session.ts";

class FakeSocket {
  connected = false;
  auth = {};
  listeners = new Map();
  connectCalls = 0;
  disconnectCalls = 0;

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  connect() {
    this.connectCalls += 1;
    this.connected = true;
    this.emit("connect");
    return this;
  }

  disconnect(reason = "io client disconnect") {
    this.disconnectCalls += 1;
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.emit("disconnect", reason);
    return this;
  }

  emit(event, ...args) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

const record = (id, overrides = {}) => ({
  id,
  type: "system",
  title: id,
  message: "message",
  data: {},
  isRead: false,
  readAt: null,
  createdAt: `2026-10-27T00:00:0${id.slice(-1)}Z`,
  ...overrides,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => (resolve = res));
  return { promise, resolve };
};

const createHarness = (overrides = {}) => {
  const socket = new FakeSocket();
  const calls = {
    history: [],
    count: 0,
    refresh: 0,
    reconnect: 0,
    realtime: [],
    markRead: [],
    markAll: 0,
  };
  const session = new NotificationSession({
    getToken: () => "token-1",
    refreshToken: async () => {
      calls.refresh += 1;
      return "token-2";
    },
    createSocket: (token) => {
      socket.auth = { token };
      return socket;
    },
    getNotifications: async (page, limit) => {
      calls.history.push({ page, limit });
      return {
        notifications: page === 1 ? [record("n1")] : [record("n2")],
        pagination: { totalPages: 2 },
      };
    },
    getUnreadCount: async () => {
      calls.count += 1;
      return 2;
    },
    markRead: async (id) => {
      calls.markRead.push(id);
      return record(id, { isRead: true, readAt: "2026-10-27T00:00:00Z" });
    },
    markAllRead: async () => {
      calls.markAll += 1;
    },
    onRealtimeEvent: (event) => calls.realtime.push(event),
    onReconnect: () => {
      calls.reconnect += 1;
    },
    ...overrides,
  });
  return { session, socket, calls };
};

test("does not create a connection before a token is available", () => {
  let creations = 0;
  const harness = createHarness({
    getToken: () => null,
    createSocket: () => {
      creations += 1;
      return new FakeSocket();
    },
  });
  harness.session.start();
  assert.equal(creations, 0);
  harness.session.dispose();
});

test("starts one socket and removes listeners and connection on cleanup", () => {
  const { session, socket } = createHarness();
  session.start();
  session.start();
  assert.equal(socket.listeners.get("notification:new").size, 1);
  assert.equal(socket.listeners.get("domain:job:updated").size, 1);
  session.dispose();
  assert.equal(socket.disconnectCalls, 1);
  assert.equal(socket.listeners.get("notification:new").size, 0);
  assert.equal(socket.listeners.get("domain:job:updated").size, 0);
});

test("refreshes the access token after server disconnect and reconnects", async () => {
  const { session, socket, calls } = createHarness();
  session.start();
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  socket.disconnect("io server disconnect");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.refresh, 1);
  assert.deepEqual(socket.auth, { token: "token-2" });
  assert.equal(socket.connectCalls, 2);
  assert.equal(session.getSnapshot().connected, true);
  assert.equal(calls.reconnect, 1);
  session.dispose();
});

test("deduplicates domain events and removes them on logout cleanup", () => {
  const { session, socket, calls } = createHarness();
  session.start();
  const payload = {
    eventVersion: 1,
    eventId: "same-event",
    entityType: "job",
    entityId: "job-1",
    action: "updated",
    occurredAt: "2026-10-28T00:00:00.000Z",
    data: {},
  };
  socket.emit("domain:job:updated", payload);
  socket.emit("domain:job:updated", payload);
  assert.equal(calls.realtime.length, 1);
  session.dispose();
  socket.emit("domain:job:updated", payload);
  assert.equal(calls.realtime.length, 1);
});

test("ignores malformed and unsupported domain events without blocking later events", () => {
  const { session, socket, calls } = createHarness();
  session.start();
  const valid = {
    eventVersion: 1,
    eventId: "valid-event",
    entityType: "job",
    entityId: "job-1",
    action: "updated",
    occurredAt: "2026-10-28T00:00:00.000Z",
    data: {},
  };

  assert.doesNotThrow(() => {
    socket.emit("domain:job:updated", null);
    socket.emit("domain:job:updated", { ...valid, eventVersion: 2 });
    socket.emit("domain:job:updated", { ...valid, data: null });
    socket.emit("domain:job:updated", {
      ...valid,
      entityType: "atm-location-task",
    });
    socket.emit("domain:job:updated", { ...valid, occurredAt: "invalid" });
    socket.emit("domain:atm-location-task:updated", {
      ...valid,
      entityType: "atm-location-task",
    });
  });
  assert.equal(calls.realtime.length, 0);

  socket.emit("domain:job:updated", valid);
  assert.equal(calls.realtime.length, 1);
  session.dispose();
});

test("refreshes once and stops retrying after an unauthorized handshake", async () => {
  const { session, socket, calls } = createHarness();
  session.start();
  socket.emit("connect_error", { data: { code: "UNAUTHORIZED" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.refresh, 1);
  assert.deepEqual(socket.auth, { token: "token-2" });
  assert.equal(socket.connectCalls, 1);
  session.dispose();
});

test("catches up all history pages and unread count on each connection", async () => {
  const { session, socket, calls } = createHarness();
  session.start();
  assert.equal(session.getSnapshot().loading, true);
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.history, [
    { page: 1, limit: 100 },
    { page: 2, limit: 100 },
  ]);
  assert.equal(calls.count, 1);
  assert.equal(session.getSnapshot().loading, false);
  assert.equal(session.getSnapshot().error, null);
  assert.deepEqual(
    session.getSnapshot().notifications.map(({ id }) => id),
    ["n2", "n1"],
  );
  assert.equal(session.getSnapshot().unreadCount, 2);

  socket.disconnect("transport close");
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.count, 2);
  session.dispose();
});

test("shows REST loading and error states, then retries successfully", async () => {
  let shouldFail = true;
  const { session } = createHarness({
    getNotifications: async () => {
      if (shouldFail) throw new Error("offline");
      return {
        notifications: [record("n1")],
        pagination: { totalPages: 1 },
      };
    },
  });
  session.start();
  assert.equal(session.getSnapshot().loading, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.getSnapshot().loading, false);
  assert.match(session.getSnapshot().error, /could not be loaded/i);

  shouldFail = false;
  await session.refresh();
  assert.equal(session.getSnapshot().error, null);
  assert.equal(session.getSnapshot().notifications[0].id, "n1");
  session.dispose();
});

test("merges live events with history by notification ID and increments unread once", async () => {
  const { session, socket } = createHarness();
  session.start();
  socket.connect();
  socket.emit("notification:new", record("live"));
  socket.emit("notification:new", record("live"));
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.notifications.filter(({ id }) => id === "live").length, 1);
  assert.equal(snapshot.unreadCount, 2);
  session.dispose();
});

test("read actions update notifications and unread count", async () => {
  const { session, socket, calls } = createHarness();
  session.start();
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  await session.markAsRead("n1");
  assert.equal(session.getSnapshot().unreadCount, 1);
  assert.equal(
    session.getSnapshot().notifications.find(({ id }) => id === "n1").isRead,
    true,
  );
  assert.deepEqual(calls.markRead, ["n1"]);
  await session.markAllAsRead();
  assert.equal(session.getSnapshot().unreadCount, 0);
  assert.equal(calls.markAll, 1);
  assert.ok(session.getSnapshot().notifications.every(({ isRead }) => isRead));
  session.dispose();
});

test("failed read requests do not change read state or unread count", async () => {
  const { session, socket } = createHarness({
    markRead: async () => {
      throw new Error("request failed");
    },
  });
  session.start();
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => session.markAsRead("n1"), /request failed/);
  assert.equal(session.getSnapshot().unreadCount, 2);
  assert.equal(
    session.getSnapshot().notifications.find(({ id }) => id === "n1").isRead,
    false,
  );
  session.dispose();
});

test("failed mark-all requests do not change read state or unread count", async () => {
  const { session, socket } = createHarness({
    markAllRead: async () => {
      throw new Error("request failed");
    },
  });
  session.start();
  socket.connect();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => session.markAllAsRead(), /request failed/);
  assert.equal(session.getSnapshot().unreadCount, 2);
  assert.ok(session.getSnapshot().notifications.every(({ isRead }) => !isRead));
  session.dispose();
});

test("keeps state isolated between user-scoped sessions", async () => {
  const first = createHarness();
  const second = createHarness();
  first.session.start();
  second.session.start();
  first.socket.connect();
  second.socket.connect();
  first.socket.emit("notification:new", record("only-first"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    first.session.getSnapshot().notifications.map(({ id }) => id),
    ["only-first", "n2", "n1"],
  );
  assert.deepEqual(
    second.session.getSnapshot().notifications.map(({ id }) => id),
    ["n2", "n1"],
  );
  first.session.dispose();
  second.session.dispose();
});

test("stops reconnecting after a refresh failure", async () => {
  const { session, socket, calls } = createHarness({
    refreshToken: async () => {
      calls.refresh += 1;
      throw new Error("refresh failed");
    },
    onError: () => {},
  });
  session.start();
  socket.connect();
  socket.disconnect("io server disconnect");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.refresh, 1);
  assert.equal(socket.connectCalls, 1);
  session.dispose();
});

test("does not overwrite a live event that arrives while catch-up is pending", async () => {
  const page = deferred();
  const { session, socket } = createHarness({
    getNotifications: async () => page.promise,
  });
  session.start();
  socket.connect();
  socket.emit("notification:new", record("n3"));
  page.resolve({
    notifications: [record("n3"), record("rest")],
    pagination: { totalPages: 1 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    session.getSnapshot().notifications.map(({ id }) => id),
    ["n3", "rest"],
  );
  session.dispose();
});
