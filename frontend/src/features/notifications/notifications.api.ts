import api from "@/lib/axios";

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPageResponse {
  notifications: NotificationResponse[];
  pagination: {
    totalPages: number;
  };
}

interface NotificationPage {
  notifications: NotificationRecord[];
  pagination: {
    totalPages: number;
  };
}

type NotificationResponse = Omit<NotificationRecord, "id"> & {
  id?: string;
  _id?: string;
};

const normalizeNotification = (notification: NotificationResponse) => {
  const { _id, ...record } = notification;
  const id = record.id ?? _id;
  if (!id) throw new Error("Notification response is missing its ID");
  return { ...record, id };
};

export const getNotifications = async (
  page: number,
  limit: number,
): Promise<NotificationPage> => {
  const response = await api.get("/notifications", {
    params: { page, limit },
  });
  const result = response.data.data as NotificationPageResponse;
  return {
    ...result,
    notifications: result.notifications.map(normalizeNotification),
  };
};

export const getUnreadNotificationCount = async (): Promise<number> => {
  const response = await api.get("/notifications/unread-count");
  return response.data.data.unreadCount as number;
};

export const markNotificationRead = async (
  id: string,
): Promise<NotificationRecord> => {
  const response = await api.put(`/notifications/${id}/read`);
  return normalizeNotification(response.data.data as NotificationResponse);
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await api.put("/notifications/read-all");
};
