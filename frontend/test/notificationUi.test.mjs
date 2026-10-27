import test from "node:test";
import assert from "node:assert/strict";
import {
  formatNotificationTimestamp,
  formatUnreadCount,
  getNotificationPanelState,
  isOutsideNotificationPanel,
  notificationButtonLabel,
  shouldCloseNotificationPanel,
  toggleNotificationPanel,
} from "../src/features/notifications/notification-ui.utils.ts";

test("unread count display hides zero at the UI boundary and caps large values", () => {
  assert.equal(formatUnreadCount(0), "0");
  assert.equal(formatUnreadCount(1), "1");
  assert.equal(formatUnreadCount(99), "99");
  assert.equal(formatUnreadCount(100), "99+");
  assert.equal(formatUnreadCount(-10), "0");
  assert.equal(formatUnreadCount(Number.NaN), "0");
});

test("notification button has an accessible unread label", () => {
  assert.equal(notificationButtonLabel(0), "Notifications");
  assert.equal(notificationButtonLabel(3), "Notifications, 3 unread");
});

test("notification panel distinguishes loading, error, empty, and populated states", () => {
  const base = { notifications: [], loading: false, error: null };
  assert.equal(
    getNotificationPanelState({ ...base, loading: true }),
    "loading",
  );
  assert.equal(
    getNotificationPanelState({ ...base, error: "load failed" }),
    "error",
  );
  assert.equal(getNotificationPanelState(base), "empty");
  assert.equal(
    getNotificationPanelState({
      ...base,
      notifications: [{ id: "n1" }],
    }),
    "notifications",
  );
});

test("notification timestamps format valid dates and handle malformed values", () => {
  assert.match(formatNotificationTimestamp("2026-10-27T12:00:00Z", "en-US"), /2026/);
  assert.equal(
    formatNotificationTimestamp("not-a-date", "en-US"),
    "Date unavailable",
  );
});

test("notification panel toggle and Escape behavior support keyboard use", () => {
  assert.equal(toggleNotificationPanel(false), true);
  assert.equal(toggleNotificationPanel(true), false);
  assert.equal(shouldCloseNotificationPanel("Escape"), true);
  assert.equal(shouldCloseNotificationPanel("Enter"), false);
});

test("outside pointer events close the panel while inside clicks do not", () => {
  const inside = {};
  const outside = {};
  const panel = { contains: (target) => target === inside };
  assert.equal(isOutsideNotificationPanel(inside, panel), false);
  assert.equal(isOutsideNotificationPanel(outside, panel), true);
  assert.equal(isOutsideNotificationPanel(null, panel), false);
  assert.equal(isOutsideNotificationPanel(outside, null), false);
});
