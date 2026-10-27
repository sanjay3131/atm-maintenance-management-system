import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildATMLocationMapUrl,
  canDecideATMLocationRequest,
  canDecideLinkedATMLocationTaskRequest,
  canReviewATMLocationRequests,
  canSubmitEmployeeATMLocationRequest,
  copyATMLocationCoordinate,
  createATMLocationRequestPayload,
  formatATMLocationRequestStatus,
  getATMLocationRequestErrorMessage,
  getATMLocationRequestListState,
  getGeolocationErrorMessage,
  isAcceptableATMLocationRequestAccuracy,
  isEmployeeLocationRequestClosed,
  isValidATMLocationCoordinatePair,
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

test("proposal coordinate helpers validate, copy each exact value, and build a map link from the proposal", async () => {
  const latitude = 12.345678;
  const longitude = -76.54321;
  const copiedValues = [];
  const writeText = async (text) => copiedValues.push(text);

  assert.equal(isValidATMLocationCoordinatePair(latitude, longitude), true);
  assert.equal(isValidATMLocationCoordinatePair(91, longitude), false);
  assert.equal(isValidATMLocationCoordinatePair(latitude, -181), false);
  assert.equal(
    buildATMLocationMapUrl(latitude, longitude),
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`,
  );
  assert.equal(buildATMLocationMapUrl(Number.NaN, longitude), null);

  await copyATMLocationCoordinate(latitude, writeText);
  await copyATMLocationCoordinate(longitude, writeText);
  assert.deepEqual(copiedValues, [String(latitude), String(longitude)]);
  await assert.rejects(
    copyATMLocationCoordinate(Number.NaN, writeText),
    /finite number/,
  );
});

test("only pending location requests can be approved or rejected", () => {
  assert.equal(canDecideATMLocationRequest("PENDING"), true);
  assert.equal(canDecideATMLocationRequest("APPROVED"), false);
  assert.equal(canDecideATMLocationRequest("REJECTED"), false);
});

test("linked task decisions require the matching pending request and PENDING_REVIEW task", () => {
  const task = {
    _id: "task-1",
    atmId: "atm-1",
    status: "PENDING_REVIEW",
    locationRequestId: "request-1",
  };
  const request = {
    _id: "request-1",
    atmId: "atm-1",
    locationTaskId: "task-1",
    status: "PENDING",
  };
  assert.equal(canDecideLinkedATMLocationTaskRequest(task, request), true);
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      { ...task, status: "REJECTED" },
      request,
    ),
    false,
  );
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      task,
      { ...request, status: "REJECTED" },
    ),
    false,
  );
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      task,
      { ...request, locationTaskId: "task-other" },
    ),
    false,
  );
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      { ...task, atmId: "atm-other" },
      request,
    ),
    false,
  );
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      task,
      { ...request, atmId: "atm-other" },
    ),
    false,
  );
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      { ...task, atmId: undefined },
      request,
    ),
    false,
  );
  assert.equal(
    canDecideLinkedATMLocationTaskRequest(
      { ...task, locationRequestId: null },
      request,
    ),
    false,
  );
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
  assert.match(page, /Copy Latitude/);
  assert.match(page, /Copy Longitude/);
  assert.match(page, /buildATMLocationMapUrl\(\s*request\.proposedLatitude,\s*request\.proposedLongitude/s);
  assert.match(page, /target="_blank"\s*rel="noopener noreferrer"/);
  assert.match(page, /Current official location/);
  assert.match(page, /Official location at submission/);
  assert.match(page, /DialogTitle/);
  assert.match(page, /Confirm approval/);
  assert.match(page, /Confirm rejection/);
  assert.match(page, /validateRejectionReason\(reason\)/);
  assert.match(page, /canDecideATMLocationRequest\(request\.status\)/);
  assert.match(page, /useATM\(atmId, Boolean\(atmId\)\)/);
  assert.doesNotMatch(page, /setATMLocation|setATMCoordinates/);

  const approvalSuccessStart = page.indexOf("const result = await approveMutation.mutateAsync");
  const approvalSuccessEnd = page.indexOf("} catch (actionError)", approvalSuccessStart);
  assert.ok(approvalSuccessStart >= 0 && approvalSuccessEnd > approvalSuccessStart);
  assert.match(
    page.slice(approvalSuccessStart, approvalSuccessEnd),
    /setNotice\("Location request approved/,
  );
  const approvalFailureBlock = page.slice(approvalSuccessEnd);
  assert.match(approvalFailureBlock, /setError\(getATMLocationRequestErrorMessage\(actionError\)\)/);
});

test("linked task proposal dialog loads, retries, guards decisions, and uses reviewed request endpoints", async () => {
  const dialog = await readFile(
    new URL(
      "../src/pages/admin/ATMLocationTaskRequestDialog.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(dialog, /useATMLocationRequest\(requestId\)/);
  assert.match(dialog, /requestQuery\.isLoading/);
  assert.match(dialog, /requestQuery\.isError/);
  assert.match(dialog, /requestQuery\.refetch\(\)/);
  assert.match(dialog, /canDecideLinkedATMLocationTaskRequest\(task, request\)/);
  assert.match(dialog, /validateRejectionReason\(reason\)/);
  assert.match(dialog, /decisionLock\.current/);
  assert.match(dialog, /useApproveATMLocationRequest/);
  assert.match(dialog, /useRejectATMLocationRequest/);
  assert.match(dialog, /buildATMLocationMapUrl\(/);
  assert.match(dialog, /copyATMLocationCoordinate\(/);
  assert.doesNotMatch(dialog, /setATMLocation|setATMCoordinates/);
});

test("admin request filters share paginated server query parameters and reset dependent regions", async () => {
  const page = await readFile(
    new URL("../src/pages/admin/ATMLocationRequestsPage.tsx", import.meta.url),
    "utf8",
  );
  const service = await readFile(
    new URL(
      "../src/features/atms/services/atm-location-requests.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const hooks = await readFile(
    new URL(
      "../src/features/atms/hooks/useATMLocationRequests.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const backendValidation = await readFile(
    new URL(
      "../../backend/src/modules/atms/atm.validation.js",
      import.meta.url,
    ),
    "utf8",
  );
  const backendService = await readFile(
    new URL(
      "../../backend/src/modules/atms/atmLocationRequest.service.js",
      import.meta.url,
    ),
    "utf8",
  );
  for (const filter of ["search", "districtId", "regionId", "employeeId"]) {
    assert.ok(service.includes(filter), `service should send ${filter}`);
    assert.ok(hooks.includes(filter), `query key should include ${filter}`);
    assert.ok(
      backendValidation.includes(`${filter}:`),
      `query validator should accept ${filter}`,
    );
    assert.ok(backendService.includes(filter), `backend should apply ${filter}`);
  }
  assert.match(page, /setDistrictId\(event\.target\.value\);\s*setRegionId\(""\)/);
  assert.match(page, /useDeferredValue\(search\)/);
  assert.match(page, /onClick=\{clearFilters\}/);
  assert.match(page, /No .*location requests match these filters/);
  assert.match(page, /setPage\(1\)/);
});

test("review mutations refresh request lists, request detail, and ATM data after server success", async () => {
  const hooks = await readFile(
    new URL(
      "../src/features/atms/hooks/useATMLocationRequests.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(hooks, /invalidateQueries\(\{ queryKey: \["atm-location-requests"\] \}\)/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: \["atm-location-request"\] \}\)/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: \["atms"\] \}\)/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: \["atm"\] \}\)/);
  assert.match(hooks, /invalidateQueries\(\{ queryKey: \["atm-location-tasks"\] \}\)/);
});
