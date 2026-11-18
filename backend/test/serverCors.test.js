import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";

const allowedOrigins = [
  "https://local-frontend.example.test",
  "https://admin-frontend.example.test",
];
process.env.FRONTEND_LOCAL_URL = allowedOrigins[0];
process.env.FRONTEND_API_URL = allowedOrigins[1];

const { default: app } = await import("../src/server.js");

const requestPreflight = (port, origin) =>
  new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/v1/atm/bulk-upload/import",
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "content-type,authorization,idempotency-key",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({ statusCode: response.statusCode, headers: response.headers }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });

test("REST CORS preflight permits import headers only for configured origins", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections?.();
    await closed;
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  for (const origin of allowedOrigins) {
    const response = await requestPreflight(address.port, origin);
    assert.equal(response.headers["access-control-allow-origin"], origin);
    assert.notEqual(response.headers["access-control-allow-origin"], "*");
    assert.equal(response.headers["access-control-allow-credentials"], "true");

    const methods = new Set(
      response.headers["access-control-allow-methods"]
        .split(",")
        .map((method) => method.trim()),
    );
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
      assert.ok(methods.has(method), `CORS must continue to allow ${method}`);
    }

    const headers = new Set(
      response.headers["access-control-allow-headers"]
        .split(",")
        .map((header) => header.trim().toLowerCase()),
    );
    for (const header of [
      "content-type",
      "authorization",
      "idempotency-key",
    ]) {
      assert.ok(headers.has(header), `CORS must allow ${header}`);
    }
  }

  const denied = await requestPreflight(
    address.port,
    "https://unlisted-frontend.example.test",
  );
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});
