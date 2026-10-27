import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/server.js";

test("GET /health returns a safe status response", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  );

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/health`,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    "message",
    "success",
    "timestamp",
  ]);
  assert.equal(body.success, true);
  assert.equal(body.message, "Server is running");
  assert.ok(Number.isFinite(Date.parse(body.timestamp)));
});
