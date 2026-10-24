import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canReviewATMLocationRequests,
  canSubmitEmployeeATMLocationRequest,
  createATMLocationRequestPayload,
  formatATMLocationRequestStatus,
  getATMLocationRequestErrorMessage,
  getATMLocationRequestListState,
  getGeolocationErrorMessage,
  isAcceptableATMLocationRequestAccuracy,
  isEmployeeLocationRequestClosed,
  parseLocationCoordinates,
  validateRejectionReason,
} from "../src/features/atms/atmLocationRequest.utils.ts";

test("employee coordinate validation accepts boundary values and rejects invalid input", () => {
  assert.deepEqual(parseLocationCoordinates("-90", "180"), {
    valid: true,
    latitude: -90,
    longitude: 180,
  });
  for (const [latitude, longitude] of [
    ["", "1"],
    ["1", " "],
    ["NaN", "1"],
    ["Infinity", "1"],
    ["90.01", "1"],
    ["1", "-180.01"],
  ]) {
    assert.equal(parseLocationCoordinates(latitude, longitude).valid, false);
  }
});

test("request payload matches backend schema and never treats manual coordinates as GPS", () => {
  assert.deepEqual(
    createATMLocationRequestPayload({
      atmId: "atm-object-id",
      amcId: "amc-object-id",
      latitude: 12.5,
      longitude: 77.6,
      accuracy: 8,
      inputSource: "GPS",
    }),
    {
      atmId: "atm-object-id",
      amcId: "amc-object-id",
      latitude: 12.5,
      longitude: 77.6,
      accuracy: 8,
      inputSource: "GPS",
    },
  );
  assert.deepEqual(
    createATMLocationRequestPayload({
      atmId: "atm-object-id",
      latitude: 12.5,
      longitude: 77.6,
      accuracy: 8,
      inputSource: "MANUAL",
    }),
    {
      atmId: "atm-object-id",
      latitude: 12.5,
      longitude: 77.6,
      inputSource: "MANUAL",
    },
  );
});

test("GPS failures have actionable messages for denied and unavailable location", () => {
  assert.match(getGeolocationErrorMessage(1), /permission was denied/);
  assert.match(getGeolocationErrorMessage(2), /location is unavailable/);
  assert.match(getGeolocationErrorMessage(3), /timed out/);
});

test("ATM location requests accept GPS accuracy up to 50 m and reject poor readings", () => {
  assert.equal(isAcceptableATMLocationRequestAccuracy(0), true);
  assert.equal(isAcceptableATMLocationRequestAccuracy(50), true);
  assert.equal(isAcceptableATMLocationRequestAccuracy(50.1), false);
  assert.equal(isAcceptableATMLocationRequestAccuracy(381), false);
  assert.equal(isAcceptableATMLocationRequestAccuracy(Number.NaN), false);
});

test("review controls are limited to Admin and SuperAdmin", () => {
  assert.equal(canReviewATMLocationRequests("admin"), true);
  assert.equal(canReviewATMLocationRequests("superAdmin"), true);
  for (const role of ["employee", "supervisor", "customer", undefined]) {
    assert.equal(canReviewATMLocationRequests(role), false);
  }
});

test("approved location request hides employee option until an Admin reopens it", () => {
  assert.equal(isEmployeeLocationRequestClosed("APPROVED", false), true);
  assert.equal(isEmployeeLocationRequestClosed("APPROVED", undefined), true);
  assert.equal(isEmployeeLocationRequestClosed("APPROVED", true), false);
  assert.equal(isEmployeeLocationRequestClosed("REJECTED", false), false);
  assert.equal(isEmployeeLocationRequestClosed("PENDING", false), false);
  assert.equal(isEmployeeLocationRequestClosed(undefined, false, true), true);
  assert.equal(isEmployeeLocationRequestClosed(undefined, true, true), false);
});

test("job location request action is available only for unconfigured ATMs or explicitly reopened windows", () => {
  assert.equal(canSubmitEmployeeATMLocationRequest(null), false);
  assert.equal(
    canSubmitEmployeeATMLocationRequest({ locationConfigured: false }),
    true,
  );
  assert.equal(
    canSubmitEmployeeATMLocationRequest({
      locationConfigured: true,
      locationRequestWindowOpen: false,
    }),
    false,
  );
  assert.equal(
    canSubmitEmployeeATMLocationRequest({
      locationConfigured: true,
      locationRequestWindowOpen: true,
    }),
    true,
  );
});

test("rejection requires trimmed text and caps accepted input at backend maximum", () => {
  assert.match(validateRejectionReason("   "), /Enter a reason/);
  assert.equal(validateRejectionReason(" Coordinates do not match "), "");
  assert.equal(validateRejectionReason("x".repeat(1000)), "");
  assert.match(validateRejectionReason("x".repeat(1001)), /1000 characters/);
});

test("list state, status label, and API errors are presented clearly", () => {
  assert.equal(
    getATMLocationRequestListState({
      isLoading: true,
      isError: false,
      requests: [],
    }),
    "loading",
  );
  assert.equal(
    getATMLocationRequestListState({
      isLoading: false,
      isError: false,
      requests: [],
    }),
    "empty",
  );
  assert.equal(
    getATMLocationRequestListState({
      isLoading: false,
      isError: false,
      requests: [{ _id: "request-1" }],
    }),
    "ready",
  );
  assert.equal(formatATMLocationRequestStatus("PENDING"), "Pending");
  assert.equal(
    getATMLocationRequestErrorMessage({
      response: { data: { message: "A pending request already exists." } },
    }),
    "A pending request already exists.",
  );
  assert.equal(
    getATMLocationRequestErrorMessage({
      response: { status: 409, data: { message: "The request is no longer pending." } },
    }),
    "The request is no longer pending.",
  );
  assert.equal(
    getATMLocationRequestErrorMessage(new Error("Network unavailable")),
    "Network unavailable",
  );
});

test("frontend request service uses only the approved request APIs", async () => {
  const service = await readFile(
    new URL(
      "../src/features/atms/services/atm-location-requests.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(service, /api\.post<.*>\(\s*"\/atm\/location-requests"/s);
  assert.match(service, /`\/atm\/location-requests\/\$\{requestId\}`/);
  assert.match(service, /`\/atm\/location-requests\/\$\{requestId\}\/approve`/);
  assert.match(service, /`\/atm\/location-requests\/\$\{requestId\}\/reject`/);
  assert.match(service, /\{\s*reason:\s*reason\.trim\(\)\s*\}/);
  assert.doesNotMatch(service, /set-location/);
});

test("admin review routes are inside the Admin/SuperAdmin protected route group", async () => {
  const app = await readFile(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );
  const adminGroupStart = app.indexOf('allowedRoles={["admin", "superAdmin"]}');
  const supervisorGroupStart = app.indexOf('allowedRoles={["supervisor"]}');
  assert.ok(adminGroupStart >= 0 && supervisorGroupStart > adminGroupStart);
  const adminGroup = app.slice(adminGroupStart, supervisorGroupStart);
  assert.match(adminGroup, /path="\/admin\/location-requests"/);
  assert.match(adminGroup, /path="\/admin\/location-requests\/:requestId"/);
});

test("employee request UI communicates pending and rejection/resubmission limits", async () => {
  const component = await readFile(
    new URL(
      "../src/features/atms/components/EmployeeATMLocationRequest.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(component, /submittedRequest\.status/);
  assert.match(component, /latestRequest\.status === "REJECTED"/);
  assert.match(component, /latestRequest\.rejectionReason/);
  assert.match(component, /submitMutation\.isPending/);
  assert.match(component, /isApprovedAndClosed/);
  assert.doesNotMatch(component, /set-location/);
});

test("job field-work location proposal uses the approval workflow, not the legacy writer", async () => {
  const component = await readFile(
    new URL(
      "../src/features/jobs/components/EmployeeFieldWorkPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(component, /useSubmitATMLocationRequest/);
  assert.match(component, /canSubmitEmployeeATMLocationRequest\(atm\)/);
  assert.match(component, /inputSource:\s*"GPS"/);
  assert.match(component, /submitted for review/i);
  assert.match(component, /isAcceptableATMLocationRequestAccuracy\(gps\.accuracy\)/);
  assert.match(component, /Retry GPS capture in a clearer area/);
  assert.doesNotMatch(component, /useSetATMLocation|setATMLocationMutation/);
  assert.doesNotMatch(component, /set-location/);
});

test("Admin decision detail refetches its populated request", async () => {
  const page = await readFile(
    new URL(
      "../src/pages/admin/ATMLocationRequestDetailsPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal((page.match(/requestQuery\.refetch\(\)/g) ?? []).length, 3);
  assert.match(page, /refreshed\.data \?\?/);
  assert.match(page, /atmId:\s*request\.atmId/);
  assert.match(page, /requestedBy:\s*request\.requestedBy/);
});
