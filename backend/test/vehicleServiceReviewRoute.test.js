import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import User from "../src/modules/users/user.model.js";

process.env.JWT_ACCESS_SECRET ??= "vehicle-review-route-test-secret";

const [{ default: vehicleRoutes }, { default: errorMiddleware }] =
  await Promise.all([
    import("../src/modules/vehicles/vehicle.routes.js"),
    import("../src/middlewares/error.middleware.js"),
  ]);

const userIds = {
  admin: "64b000000000000000000301",
  superAdmin: "64b000000000000000000302",
  employee: "64b000000000000000000303",
};

const users = new Map(
  Object.entries(userIds).map(([userType, _id]) => [
    _id,
    { _id, userType, status: "active" },
  ]),
);

const requestBody = {
  expectedVehicleRevision: 3,
  confirmReviewed: true,
  reason: "Verified service paperwork",
};

test("service conflict review route denies employees and accepts both admin roles", async () => {
  const originalFindById = User.findById;
  User.findById = (id) => ({
    select() { return this; },
    then(resolve, reject) {
      return Promise.resolve(users.get(String(id)) ?? null).then(resolve, reject);
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/vehicles", vehicleRoutes);
  app.use(errorMiddleware);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/v1/vehicles/admin/64b000000000000000000311/services/64b000000000000000000312/review`;

  const makeRequest = (userId, body = requestBody) =>
    fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  try {
    const employeeResponse = await makeRequest(userIds.employee);
    assert.equal(employeeResponse.status, 403);

    const adminResponse = await makeRequest(userIds.admin);
    assert.equal(adminResponse.status, 503);

    const superAdminResponse = await makeRequest(userIds.superAdmin);
    assert.equal(superAdminResponse.status, 503);

    const invalidConfirmation = await makeRequest(userIds.admin, {
      ...requestBody,
      confirmReviewed: false,
    });
    assert.equal(invalidConfirmation.status, 400);
  } finally {
    User.findById = originalFindById;
    await new Promise((resolve) => server.close(resolve));
  }
});