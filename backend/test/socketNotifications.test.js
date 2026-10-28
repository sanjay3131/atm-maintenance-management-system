import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET ??= "socket-test-access-secret";

const [
  { initSocketServer, closeSocketServer, emitToUser },
  { default: User },
  { default: Notification },
  { createNotification },
  { publishDomainEvent, publishDomainEventSafely },
] = await Promise.all([
  import("../src/realtime/socket.js"),
  import("../src/modules/users/user.model.js"),
  import("../src/modules/notification/notification.model.js"),
  import("../src/modules/notification/notification.service.js"),
  import("../src/realtime/domain-events.js"),
]);

const ALLOWED = "https://app.example.com";
const ids = {
  a: "64b000000000000000000401",
  b: "64b000000000000000000402",
  blocked: "64b000000000000000000403",
  inactive: "64b000000000000000000404",
  missing: "64b000000000000000000405",
};
const users = {
  [ids.a]: { _id: ids.a, status: "active" },
  [ids.b]: { _id: ids.b, status: "active" },
  [ids.blocked]: { _id: ids.blocked, status: "blocked" },
  [ids.inactive]: { _id: ids.inactive, status: "inactive" },
};

const sign = (id, opts = { expiresIn: "5m" }) =>
  jwt.sign({ id }, process.env.JWT_ACCESS_SECRET, opts);

const originalFindById = User.findById;
const originalCreate = Notification.create;
User.findById = (id) => ({
  select: async () => users[String(id)] ?? null,
});

const httpServer = http.createServer((req, res) => res.end("ok"));
initSocketServer(httpServer, { allowedOrigins: [ALLOWED] });
await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
const port = httpServer.address().port;

test.after(async () => {
  User.findById = originalFindById;
  Notification.create = originalCreate;
  await closeSocketServer();
  httpServer.closeAllConnections?.();
  await new Promise((r) => httpServer.close(r));
});

// Minimal Socket.IO v4 websocket client (the client package is not a backend dependency).
const connect = (auth) =>
  new Promise((resolve) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`,
    );
    const client = { events: [], ws, state: "connecting", error: null };
    client.waitFor = (event, timeout = 1000) =>
      new Promise((res, rej) => {
        const started = Date.now();
        const poll = setInterval(() => {
          const hit = client.events.find((e) => e[0] === event);
          if (hit) {
            clearInterval(poll);
            res(hit[1]);
          } else if (Date.now() - started > timeout) {
            clearInterval(poll);
            rej(new Error(`timeout waiting for ${event}`));
          }
        }, 10);
      });
    client.closed = new Promise((res) => ws.addEventListener("close", res));
    ws.addEventListener("message", ({ data }) => {
      const text = String(data);
      if (text === "2") return ws.send("3");
      if (text.startsWith("0")) {
        return ws.send(`40${JSON.stringify(auth ?? {})}`);
      }
      if (text.startsWith("40")) {
        client.state = "connected";
        return resolve(client);
      }
      if (text.startsWith("44")) {
        client.state = "rejected";
        client.error = JSON.parse(text.slice(2));
        return resolve(client);
      }
      if (text.startsWith("42")) client.events.push(JSON.parse(text.slice(2)));
    });
    ws.addEventListener("error", () => {
      client.state = "error";
      resolve(client);
    });
  });

const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

const fakeCreate = (calls) => async (doc) => {
  calls.push(doc);
  return {
    _id: `64b0000000000000000005${String(calls.length).padStart(2, "0")}`,
    isRead: false,
    readAt: null,
    createdAt: new Date(),
    ...doc,
  };
};

const input = (userId, extra = {}) => ({
  userId,
  type: "system",
  title: "Hello",
  message: "World",
  ...extra,
});

test("rejects handshakes with missing, malformed, expired, or wrongly signed tokens", async () => {
  const cases = [
    undefined,
    { token: "" },
    { token: "garbage" },
    { token: sign(ids.a, { expiresIn: -10 }) },
    { token: jwt.sign({ id: ids.a }, "wrong-secret") },
    { token: 12345 },
  ];
  for (const auth of cases) {
    const client = await connect(auth);
    assert.equal(client.state, "rejected", JSON.stringify(auth));
    client.ws.close();
  }
});

test("rejects missing, blocked, and inactive users", async () => {
  for (const id of [ids.missing, ids.blocked, ids.inactive]) {
    const client = await connect({ token: sign(id) });
    assert.equal(client.state, "rejected", id);
    client.ws.close();
  }
});

test("accepts a valid token, with or without a Bearer prefix", async () => {
  const plain = await connect({ token: sign(ids.a) });
  const bearer = await connect({ token: `Bearer ${sign(ids.a)}` });
  assert.equal(plain.state, "connected");
  assert.equal(bearer.state, "connected");
  plain.ws.close();
  bearer.ws.close();
});

test("a token in the query string is not accepted", async () => {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket&token=${sign(ids.a)}`,
  );
  const result = await new Promise((resolve) => {
    ws.addEventListener("message", ({ data }) => {
      const text = String(data);
      if (text.startsWith("0")) ws.send("40");
      if (text.startsWith("40") || text.startsWith("44")) resolve(text);
    });
  });
  assert.ok(result.startsWith("44"));
  ws.close();
});

test("delivers a persisted notification only to its recipient's room", async (t) => {
  const calls = [];
  Notification.create = fakeCreate(calls);
  t.after(() => (Notification.create = originalCreate));

  const a = await connect({ token: sign(ids.a) });
  const b = await connect({ token: sign(ids.b) });

  const result = await createNotification(
    input(ids.a, { data: { amcId: "x" } }),
  );
  assert.equal(result.created, true);
  const payload = await a.waitFor("notification:new");
  assert.equal(payload.title, "Hello");
  assert.deepEqual(payload.data, { amcId: "x" });
  assert.equal(payload.isRead, false);
  assert.equal(payload.userId, undefined);
  assert.equal(payload.dedupeKey, undefined);

  await settle();
  assert.equal(b.events.length, 0);
  a.ws.close();
  b.ws.close();
});

test("a client cannot join rooms or spoof recipients", async (t) => {
  const a = await connect({ token: sign(ids.a), room: `user:${ids.b}` });
  const b = await connect({ token: sign(ids.b) });
  a.ws.send(`42${JSON.stringify(["join", `user:${ids.b}`])}`);
  a.ws.send(`42${JSON.stringify(["join-room", { userId: ids.b }])}`);
  await settle();

  emitToUser(ids.b, "notification:new", { id: "1" });
  await b.waitFor("notification:new");
  await settle();
  assert.equal(a.events.length, 0);
  a.ws.close();
  b.ws.close();
});

test("delivers to every connection of the same user", async (t) => {
  Notification.create = fakeCreate([]);
  t.after(() => (Notification.create = originalCreate));
  const one = await connect({ token: sign(ids.a) });
  const two = await connect({ token: sign(ids.a) });
  await createNotification(input(ids.a));
  await one.waitFor("notification:new");
  await two.waitFor("notification:new");
  one.ws.close();
  two.ws.close();
});

test("publishes versioned domain events only to server-resolved recipients", async () => {
  const a = await connect({ token: sign(ids.a) });
  const b = await connect({ token: sign(ids.b) });

  await publishDomainEvent({
    event: "domain:job:updated",
    entityType: "job",
    entityId: "job-1",
    action: "reassigned",
    resolveRecipients: async () => [ids.a],
    data: { status: "ASSIGNED" },
  });

  const payload = await a.waitFor("domain:job:updated");
  assert.equal(payload.eventVersion, 1);
  assert.equal(payload.entityId, "job-1");
  assert.equal(payload.action, "reassigned");
  assert.equal(payload.data.status, "ASSIGNED");
  assert.equal(payload.data.employeeGpsAtCompletion, undefined);
  await settle();
  assert.equal(
    b.events.some(([event]) => event === "domain:job:updated"),
    false,
  );
  a.ws.close();
  b.ws.close();
});

test("domain event resolver failures do not reject a committed mutation response", async () => {
  const a = await connect({ token: sign(ids.a) });
  const result = await publishDomainEventSafely({
    event: "domain:job:updated",
    entityType: "job",
    entityId: "job-2",
    action: "updated",
    resolveRecipients: async () => {
      throw new Error("resolver unavailable");
    },
  });
  assert.equal(result, null);
  await settle();
  assert.equal(a.events.length, 0);
  a.ws.close();
});

test("duplicates are not emitted again", async (t) => {
  const seen = new Set();
  Notification.create = async (doc) => {
    if (seen.has(doc.dedupeKey)) {
      throw Object.assign(new Error("dup"), { code: 11000 });
    }
    seen.add(doc.dedupeKey);
    return { _id: "64b000000000000000000601", createdAt: new Date(), ...doc };
  };
  t.after(() => (Notification.create = originalCreate));

  const a = await connect({ token: sign(ids.a) });
  const first = await createNotification(input(ids.a, { dedupeKey: "k1" }));
  const second = await createNotification(input(ids.a, { dedupeKey: "k1" }));
  assert.equal(first.created, true);
  assert.equal(second.duplicate, true);
  await a.waitFor("notification:new");
  await settle();
  assert.equal(a.events.length, 1);
  a.ws.close();
});

test("persistence failure rethrows and emits nothing", async (t) => {
  Notification.create = async () => {
    throw new Error("db down");
  };
  t.after(() => (Notification.create = originalCreate));

  const a = await connect({ token: sign(ids.a) });
  await assert.rejects(() => createNotification(input(ids.a)), /db down/);
  await settle();
  assert.equal(a.events.length, 0);
  a.ws.close();
});

test("emit is not attempted before persistence completes", async (t) => {
  let release;
  Notification.create = (doc) =>
    new Promise((resolve) => {
      release = () =>
        resolve({ _id: "64b000000000000000000701", createdAt: new Date(), ...doc });
    });
  t.after(() => (Notification.create = originalCreate));

  const a = await connect({ token: sign(ids.a) });
  const pending = createNotification(input(ids.a));
  await settle();
  assert.equal(a.events.length, 0);
  release();
  await pending;
  await a.waitFor("notification:new");
  a.ws.close();
});

test("the socket disconnects when the access token expires", async () => {
  const client = await connect({ token: sign(ids.a, { expiresIn: 1 }) });
  assert.equal(client.state, "connected");
  await Promise.race([
    client.closed,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("not disconnected")), 3000),
    ),
  ]);
});

test("origin validation mirrors the REST CORS allow-list", async () => {
  const probe = (origin) =>
    new Promise((resolve) => {
      const req = http.request(
        `http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`,
        { headers: origin ? { Origin: origin } : {} },
        (res) => {
          res.resume();
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              acao: res.headers["access-control-allow-origin"],
            }),
          );
        },
      );
      req.end();
    });

  const allowed = await probe(ALLOWED);
  assert.equal(allowed.acao, ALLOWED);
  const denied = await probe("https://evil.example.com");
  assert.equal(denied.acao, undefined);
  const noOrigin = await probe();
  assert.equal(noOrigin.status, 200);
});

test("emitToUser is a safe no-op without a server", async () => {
  await closeSocketServer();
  assert.equal(emitToUser(ids.a, "x", {}), false);
});
