import type { NotificationSnapshot } from "./notification-session";

export const formatUnreadCount = (count: number) => {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return safeCount > 99 ? "99+" : String(safeCount);
};

export const getNotificationPanelState = (
  snapshot: Pick<NotificationSnapshot, "notifications" | "loading" | "error">,
) => {
  if (snapshot.loading && snapshot.notifications.length === 0) return "loading";
  if (snapshot.error && snapshot.notifications.length === 0) return "error";
  if (snapshot.notifications.length === 0) return "empty";
  return "notifications";
};

export const notificationButtonLabel = (unreadCount: number) =>
  unreadCount > 0
    ? `Notifications, ${unreadCount} unread`
    : "Notifications";

export const getVehicleServiceNotificationHref = (
  notification: { type?: unknown; data?: Record<string, unknown> },
  userType?: string,
) => {
  if (
    notification.type !== "system" ||
    notification.data?.serviceType !== "OIL_CHANGE"
  ) return null;
  const vehicleId = notification.data?.vehicleId;
  if (typeof vehicleId !== "string" || !/^[a-fA-F0-9]{24}$/.test(vehicleId)) {
    return null;
  }
  if (userType === "admin" || userType === "superAdmin") {
    return `/admin/vehicles/${vehicleId}`;
  }
  if (userType === "employee") return "/employee/mileage";
  return null;
};

export const formatNotificationTimestamp = (
  value: string,
  locale?: string,
) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export const toggleNotificationPanel = (isOpen: boolean) => !isOpen;

export const shouldCloseNotificationPanel = (key: string) => key === "Escape";

export const isOutsideNotificationPanel = (
  target: EventTarget | null,
  panel: Pick<HTMLElement, "contains"> | null,
) => Boolean(target && panel && !panel.contains(target as Node));
