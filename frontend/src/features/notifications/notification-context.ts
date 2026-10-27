import { createContext } from "react";
import type { NotificationSnapshot } from "./notification-session";

export interface NotificationContextValue extends NotificationSnapshot {
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

export const NotificationContext =
  createContext<NotificationContextValue | null>(null);
