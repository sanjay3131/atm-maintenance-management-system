import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import User from "../modules/users/user.model.js";

export const NOTIFICATION_EVENT = "notification:new";
export const JOB_EVENT = "domain:job:updated";
export const LOCATION_TASK_EVENT = "domain:atm-location-task:updated";
export const LOCATION_REQUEST_EVENT = "domain:atm-location-request:updated";
export const VEHICLE_EVENT = "domain:vehicle:updated";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

let io = null;
let socketClosePromise;
let socketCleanupInProgress = false;
let socketCleanupFailed = false;

export const userRoom = (userId) => `user:${String(userId)}`;
export const roleRoom = (role) => `role:${String(role)}`;

export const toNotificationPayload = (notification) => ({
  id: String(notification._id),
  type: notification.type,
  title: notification.title,
  message: notification.message,
  data: notification.data ?? {},
  isRead: Boolean(notification.isRead),
  readAt: notification.readAt ?? null,
  createdAt: notification.createdAt,
});

const extractToken = (socket) => {
  const raw = socket.handshake?.auth?.token;
  if (typeof raw !== "string") return null;
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
  return token.trim() || null;
};

const authError = (message) => {
  const error = new Error(message);
  error.data = { code: "UNAUTHORIZED" };
  return error;
};

// Mirrors verifyAccessToken: valid JWT, user still exists, not blocked/inactive.
export const authenticateSocket = async (socket, next) => {
  try {
    const token = extractToken(socket);
    if (!token) return next(authError("Access token is required"));

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch {
      return next(authError("Invalid or expired access token"));
    }

    const user = await User.findById(decoded.id).select("-password");
    if (!user) return next(authError("Unauthorized user"));
    if (user.status === "blocked" || user.status === "inactive") {
      return next(authError("Account is not active"));
    }

    socket.data.userId = String(user._id);
    socket.data.userType = user.userType;
    socket.data.tokenExp = decoded.exp;
    return next();
  } catch {
    return next(authError("Authentication failed"));
  }
};

const handleConnection = (socket) => {
  // Room is derived only from the verified database user; clients cannot pick one.
  socket.join(userRoom(socket.data.userId));
  if (["employee", "admin", "superAdmin"].includes(socket.data.userType)) {
    socket.join(roleRoom(socket.data.userType));
  }

  let timer = null;
  if (socket.data.tokenExp) {
    const ms = socket.data.tokenExp * 1000 - Date.now();
    if (ms <= 0) {
      socket.disconnect(true);
      return;
    }
    // Disconnect when the access token expires; client reconnects with a fresh token.
    timer = setTimeout(
      () => socket.disconnect(true),
      Math.min(ms, MAX_TIMEOUT_MS),
    );
    timer.unref?.();
  }

  socket.on("disconnect", () => {
    if (timer) clearTimeout(timer);
  });
};

export const initSocketServer = (httpServer, { allowedOrigins = [] } = {}) => {
  if (io) return io;
  if (socketCleanupInProgress) {
    throw new Error("Cannot initialize Socket.IO while cleanup is in progress");
  }
  if (socketCleanupFailed) {
    throw new Error("Cannot initialize Socket.IO after cleanup failed");
  }

  socketClosePromise = undefined;
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  io.use(authenticateSocket);
  io.on("connection", handleConnection);
  return io;
};

export const closeSocketConnections = () => {
  if (socketClosePromise) return socketClosePromise;

  if (!io) {
    socketClosePromise = Promise.resolve();
    return socketClosePromise;
  }

  const current = io;
  io = null;
  socketCleanupInProgress = true;

  socketClosePromise = (async () => {
    try {
      const cleanupErrors = [];

      try {
        current.disconnectSockets(true);
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        await current.sockets.adapter.close();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        current.engine.close();
      } catch (error) {
        cleanupErrors.push(error);
      }

      if (cleanupErrors.length) {
        throw new AggregateError(
          cleanupErrors,
          "Socket.IO connection cleanup failed",
        );
      }
    } catch (error) {
      socketCleanupFailed = true;
      throw error;
    } finally {
      socketCleanupInProgress = false;
    }
  })();

  return socketClosePromise;
};

export const closeSocketServer = () => {
  if (socketClosePromise) return socketClosePromise;

  if (!io) {
    socketClosePromise = Promise.resolve();
    return socketClosePromise;
  }

  const current = io;
  io = null;
  socketCleanupInProgress = true;

  socketClosePromise = (async () => {
    try {
      let httpCloseError;
      await current.close((error) => {
        httpCloseError = error;
      });
      if (httpCloseError) throw httpCloseError;
    } catch (error) {
      socketCleanupFailed = true;
      throw error;
    } finally {
      socketCleanupInProgress = false;
    }
  })();

  return socketClosePromise;
};

export const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return false;
  io.to(userRoom(userId)).emit(event, payload);
  return true;
};

export const emitToRoles = (roles, event, payload) => {
  if (!io || !Array.isArray(roles) || roles.length === 0) return false;
  const [firstRole, ...remainingRoles] = roles;
  let target = io.to(roleRoom(firstRole));
  for (const role of remainingRoles) target = target.to(roleRoom(role));
  target.emit(event, payload);
  return true;
};
