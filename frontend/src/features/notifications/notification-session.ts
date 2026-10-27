import type { NotificationRecord } from "./notifications.api";

export interface NotificationSocket {
  connected: boolean;
  auth: Record<string, unknown>;
  on<E extends keyof NotificationSocketEvents>(
    event: E,
    listener: NotificationSocketEvents[E],
  ): this;
  off<E extends keyof NotificationSocketEvents>(
    event: E,
    listener: NotificationSocketEvents[E],
  ): this;
  connect(): this;
  disconnect(): this;
}

interface NotificationSocketEvents {
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: { data?: { code?: string } }) => void;
  "notification:new": (notification: NotificationRecord) => void;
}

export interface NotificationSnapshot {
  notifications: NotificationRecord[];
  unreadCount: number;
  connected: boolean;
  loading: boolean;
  error: string | null;
}

interface NotificationSessionOptions {
  getToken: () => string | null;
  refreshToken: () => Promise<string>;
  createSocket: (token: string) => NotificationSocket;
  getNotifications: (
    page: number,
    limit: number,
  ) => Promise<{
    notifications: NotificationRecord[];
    pagination: { totalPages: number };
  }>;
  getUnreadCount: () => Promise<number>;
  markRead: (id: string) => Promise<NotificationRecord>;
  markAllRead: () => Promise<void>;
  onError?: (error: unknown) => void;
}

const PAGE_SIZE = 100;
const emptySnapshot = (): NotificationSnapshot => ({
  notifications: [],
  unreadCount: 0,
  connected: false,
  loading: false,
  error: null,
});

const mergeNotifications = (
  current: NotificationRecord[],
  incoming: NotificationRecord[],
) => {
  const byId = new Map(current.map((notification) => [notification.id, notification]));
  for (const notification of incoming) {
    if (notification.id) byId.set(notification.id, notification);
  }
  return [...byId.values()].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
};

export class NotificationSession {
  private socket: NotificationSocket | null = null;
  private listeners = new Set<(snapshot: NotificationSnapshot) => void>();
  private snapshot = emptySnapshot();
  private disposed = false;
  private refreshAttempted = false;
  private refreshInProgress = false;
  private hasConnected = false;
  private catchUpSequence = 0;
  private handlers: Array<() => void> = [];
  private readonly options: NotificationSessionOptions;

  constructor(options: NotificationSessionOptions) {
    this.options = options;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: (snapshot: NotificationSnapshot) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start() {
    if (this.disposed || this.socket) return;
    const token = this.options.getToken();
    if (!token) return;

    try {
      this.socket = this.options.createSocket(token);
      this.listen("connect", this.handleConnect);
      this.listen("disconnect", this.handleDisconnect);
      this.listen("connect_error", this.handleConnectError);
      this.listen("notification:new", this.handleNotification);
    } catch (error) {
      this.options.onError?.(error);
    }
    void this.catchUp();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.catchUpSequence += 1;
    if (this.socket) {
      for (const removeListener of this.handlers) removeListener();
      this.handlers = [];
      this.socket.disconnect();
      this.socket = null;
    }
    this.snapshot = emptySnapshot();
    this.listeners.clear();
  }

  refresh() {
    return this.catchUp();
  }

  async markAsRead(id: string) {
    const before = this.snapshot.notifications.find((item) => item.id === id);
    const updated = await this.options.markRead(id);
    this.update({
      notifications: mergeNotifications(this.snapshot.notifications, [updated]),
      unreadCount: before && !before.isRead
        ? Math.max(0, this.snapshot.unreadCount - 1)
        : this.snapshot.unreadCount,
    });
  }

  async markAllAsRead() {
    await this.options.markAllRead();
    const now = new Date().toISOString();
    this.update({
      notifications: this.snapshot.notifications.map((notification) => ({
        ...notification,
        isRead: true,
        readAt: notification.readAt ?? now,
      })),
      unreadCount: 0,
    });
  }

  private listen<E extends keyof NotificationSocketEvents>(
    event: E,
    handler: NotificationSocketEvents[E],
  ) {
    const socket = this.socket;
    if (!socket) return;
    socket.on(event, handler);
    this.handlers.push(() => socket.off(event, handler));
  }

  private update(patch: Partial<NotificationSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private handleConnect = () => {
    this.refreshAttempted = false;
    this.update({ connected: true, error: null });
    if (this.hasConnected) void this.catchUp();
    this.hasConnected = true;
  };

  private handleDisconnect = (reason: string) => {
    this.update({ connected: false });
    if (reason === "io server disconnect") {
      void this.refreshAndReconnect();
    }
  };

  private handleConnectError = (error: { data?: { code?: string } }) => {
    if (error?.data?.code === "UNAUTHORIZED") {
      void this.refreshAndReconnect(true);
    } else {
      this.options.onError?.(error);
      this.update({
        error: "Live updates are temporarily unavailable. Notifications can still be refreshed.",
      });
    }
  };

  private handleNotification = (notification: NotificationRecord) => {
    if (!notification?.id) return;
    const exists = this.snapshot.notifications.some(
      (item) => item.id === notification.id,
    );
    this.update({
      notifications: mergeNotifications(this.snapshot.notifications, [
        notification,
      ]),
      unreadCount:
        !exists && !notification.isRead
          ? this.snapshot.unreadCount + 1
          : this.snapshot.unreadCount,
    });
  };

  private async refreshAndReconnect(stopReconnect = false) {
    if (
      this.disposed ||
      !this.socket ||
      this.refreshAttempted ||
      this.refreshInProgress
    ) {
      return;
    }
    this.refreshAttempted = true;
    this.refreshInProgress = true;
    const socket = this.socket;
    if (stopReconnect) socket.disconnect();
    try {
      const token = await this.options.refreshToken();
      if (this.disposed || !this.socket || socket !== this.socket) return;
      socket.auth = { token };
      socket.connect();
    } catch (error) {
      this.options.onError?.(error);
      this.socket?.disconnect();
    } finally {
      this.refreshInProgress = false;
    }
  }

  private async catchUp() {
    const sequence = ++this.catchUpSequence;
    this.update({ loading: true, error: null });
    try {
      const firstPage = await this.options.getNotifications(1, PAGE_SIZE);
      const history = [...firstPage.notifications];
      for (let page = 2; page <= firstPage.pagination.totalPages; page += 1) {
        const result = await this.options.getNotifications(page, PAGE_SIZE);
        history.push(...result.notifications);
      }
      const unreadCount = await this.options.getUnreadCount();
      if (this.disposed || sequence !== this.catchUpSequence) return;
      this.update({
        notifications: mergeNotifications(this.snapshot.notifications, history),
        unreadCount,
      });
    } catch (error) {
      if (!this.disposed && sequence === this.catchUpSequence) {
        this.options.onError?.(error);
        this.update({
          error: "Notifications could not be loaded. Please try again.",
        });
      }
    } finally {
      if (!this.disposed && sequence === this.catchUpSequence) {
        this.update({ loading: false });
      }
    }
  }
}

export const emptyNotificationSnapshot = emptySnapshot;
