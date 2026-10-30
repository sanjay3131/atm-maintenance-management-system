import { useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCheck, LoaderCircle, X } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";
import { useNotifications } from "./use-notifications";
import {
  formatNotificationTimestamp,
  formatUnreadCount,
  getNotificationPanelState,
  isOutsideNotificationPanel,
  notificationButtonLabel,
  shouldCloseNotificationPanel,
  toggleNotificationPanel,
} from "./notification-ui.utils";

const INITIAL_VISIBLE_COUNT = 6;

export default function NotificationBell() {
  const { user } = useAuth();
  return <NotificationBellForUser key={user?._id ?? "anonymous"} />;
}

function NotificationBellForUser() {
  const {
    notifications,
    unreadCount,
    connected,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    refreshNotifications,
  } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const unreadLabel = formatUnreadCount(unreadCount);
  const panelState = getNotificationPanelState({
    notifications,
    loading,
    error,
  });

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (isOutsideNotificationPanel(event.target, panelRef.current)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldCloseNotificationPanel(event.key)) return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen((open) => toggleNotificationPanel(open));
    setActionError(null);
  };

  const closePanel = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleMarkRead = async (id: string) => {
    setPendingId(id);
    setActionError(null);
    try {
      await markAsRead(id);
    } catch {
      setActionError("Could not mark this notification as read. Try again.");
    } finally {
      setPendingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    setActionError(null);
    try {
      await markAllAsRead();
    } catch {
      setActionError("Could not mark all notifications as read. Try again.");
    } finally {
      setMarkingAll(false);
    }
  };

  const visibleNotifications = notifications.slice(0, visibleCount);
  const remainingCount = Math.max(0, notifications.length - visibleCount);

  return (
    <div ref={panelRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={notificationButtonLabel(unreadCount)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="notification-panel"
        onClick={handleToggle}
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white dark:ring-slate-950"
          >
            {unreadLabel}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-panel"
          role="dialog"
          aria-labelledby="notification-panel-heading"
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(34rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="min-w-0">
              <h2
                id="notification-panel-heading"
                className="font-semibold leading-6"
              >
                Notifications
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {connected ? "Live updates on" : "Reconnecting live updates"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={markingAll}
                  onClick={() => void handleMarkAllRead()}
                  className="rounded-md px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/50"
                >
                  {markingAll ? "Saving…" : "Mark all read"}
                </button>
              )}
              <button
                type="button"
                aria-label="Close notifications"
                onClick={closePanel}
                className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-slate-800"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {actionError && (
            <p
              role="alert"
              className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {actionError}
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void refreshNotifications()}
                className="shrink-0 rounded px-2 py-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700"
              >
                Retry
              </button>
            </div>
          )}

          <div className="min-h-0 overflow-y-auto">
            {panelState === "loading" ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500 dark:text-slate-400"
              >
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                Loading notifications…
              </div>
            ) : panelState === "error" ? (
              <p
                role="status"
                className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
              >
                Notifications are unavailable.
              </p>
            ) : panelState === "empty" ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                You’re all caught up.
              </p>
            ) : (
              <>
                <ul aria-label="Recent notifications" className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleNotifications.map((notification) => (
                    <li
                      key={notification.id}
                      className={`flex gap-3 px-4 py-3 ${
                        notification.isRead
                          ? "bg-white dark:bg-slate-900"
                          : "bg-blue-50/70 dark:bg-blue-950/20"
                      }`}
                    >
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          notification.isRead
                            ? "ring-1 ring-slate-300 dark:ring-slate-600"
                            : "bg-blue-600"
                        }`}
                      >
                        {!notification.isRead && (
                          <span className="sr-only">Unread</span>
                        )}
                        {notification.isRead && (
                          <span className="sr-only">Read</span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="break-words text-sm font-semibold">
                            {notification.title}
                          </h3>
                          {!notification.isRead && (
                            <button
                              type="button"
                              aria-label={`Mark ${notification.title} as read`}
                              disabled={pendingId === notification.id}
                              onClick={() =>
                                void handleMarkRead(notification.id)
                              }
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/50"
                            >
                              {pendingId === notification.id ? (
                                <LoaderCircle
                                  className="size-4 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Check
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          )}
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">
                          {notification.message}
                        </p>
                        <time
                          dateTime={notification.createdAt}
                          className="mt-1 block text-xs text-slate-500 dark:text-slate-400"
                        >
                          {formatNotificationTimestamp(notification.createdAt)}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
                {remainingCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount((count) =>
                        Math.min(notifications.length, count + INITIAL_VISIBLE_COUNT),
                      )
                    }
                    className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-slate-100 px-4 text-sm font-semibold text-blue-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:border-slate-800 dark:text-blue-300 dark:hover:bg-slate-800"
                  >
                    <CheckCheck className="size-4" aria-hidden="true" />
                    Show {Math.min(remainingCount, INITIAL_VISIBLE_COUNT)} older
                    notifications
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
