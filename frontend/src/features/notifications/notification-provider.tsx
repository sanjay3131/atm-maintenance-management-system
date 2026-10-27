import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import { useAuth } from "@/features/auth/auth-context";
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.api";
import {
  emptyNotificationSnapshot,
  NotificationSession,
  type NotificationSocket,
} from "./notification-session";
import { NotificationContext } from "./notification-context";

const EMPTY_SNAPSHOT = emptyNotificationSnapshot();
const EMPTY_LISTENERS = () => () => {};
const EMPTY_GET_SNAPSHOT = () => EMPTY_SNAPSHOT;

const createSocket = (token: string): NotificationSocket => {
  const apiBase = import.meta.env.API_URL as string | undefined;
  if (!apiBase) throw new Error("API_URL is not configured");
  const origin = new URL(apiBase, window.location.origin).origin;
  const socket = io(origin, {
    auth: { token },
    withCredentials: true,
    reconnection: true,
    autoConnect: true,
  });

  const adapter: NotificationSocket = {
    get connected() {
      return socket.connected;
    },
    get auth() {
      return socket.auth as Record<string, unknown>;
    },
    set auth(value: Record<string, unknown>) {
      socket.auth = value;
    },
    on(event, listener) {
      socket.on(event as never, listener as never);
      return adapter;
    },
    off(event, listener) {
      socket.off(event as never, listener as never);
      return adapter;
    },
    connect() {
      socket.connect();
      return adapter;
    },
    disconnect() {
      socket.disconnect();
      return adapter;
    },
  };
  return adapter;
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, isLoading, refreshSocketAccessToken } = useAuth();
  const userId = !isLoading ? user?._id : undefined;
  const session = useMemo(() => {
    if (!userId) return null;
    return new NotificationSession({
      getToken: () => localStorage.getItem("accessToken"),
      refreshToken: refreshSocketAccessToken,
      createSocket,
      getNotifications,
      getUnreadCount: getUnreadNotificationCount,
      markRead: markNotificationRead,
      markAllRead: markAllNotificationsRead,
      onError: (error) => console.warn("Notification connection issue:", error),
    });
  }, [refreshSocketAccessToken, userId]);

  useEffect(() => {
    session?.start();
    return () => {
      session?.dispose();
    };
  }, [session]);

  const subscribe = session?.subscribe ?? EMPTY_LISTENERS;
  const getSnapshot =
    session?.getSnapshot ?? EMPTY_GET_SNAPSHOT;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const requireSession = useCallback(() => {
    if (!session) throw new Error("No authenticated notification session");
    return session;
  }, [session]);

  const markAsRead = useCallback(
    (id: string) => requireSession().markAsRead(id),
    [requireSession],
  );
  const markAllAsRead = useCallback(
    () => requireSession().markAllAsRead(),
    [requireSession],
  );
  const refreshNotifications = useCallback(async () => {
    await requireSession().refresh();
  }, [requireSession]);

  const value = useMemo(
    () => ({
      ...snapshot,
      markAsRead,
      markAllAsRead,
      refreshNotifications,
    }),
    [markAllAsRead, markAsRead, refreshNotifications, snapshot],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
