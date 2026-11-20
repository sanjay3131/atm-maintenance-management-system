import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import http from "http";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import path from "path";
import { initSocketServer, closeSocketConnections } from "./realtime/socket.js";

import connectDb from "./config/db.js";
import { initializeDatabaseIndexes } from "./config/databaseIndexReadiness.js";
import { initCronJobs } from "./config/cronJobs.js";

// Import all routers
import userRouter from "./modules/users/user.routes.js";
import authRouter from "./modules/auth/auth.routes.js";
import employeeRouter from "./modules/employees/employee.routes.js";
import customerRouter from "./modules/customers/customer.routes.js";
import atmRouter from "./modules/atms/atm.routes.js";
import districtRouter from "./modules/districts/district.route.js";
import regionRouter from "./modules/region/region.routes.js";
import jobRouter from "./modules/jobs/jobs.routes.js";
import jobPhotoRouter from "./modules/jobPhotos/jobPhotos.route.js";
import complaintRouter from "./modules/complaints/complaints.route.js";
import dashboardRouter from "./modules/dashboard/dashboard.routes.js";
import bankRouter from "./modules/banks/bank.routes.js";
import amcRouter from "./modules/amc/amc.routes.js";
import amcPhotoRouter from "./modules/amcPhotos/amcPhoto.routes.js";
import notificationRouter from "./modules/notification/notification.routes.js";
import supervisorRouter from "./modules/supervisor/supervisor.routes.js";
import itemRouter from "./modules/items/item.routes.js";
import attendanceRouter from "./modules/attendance/attendance.routes.js";
import publicHolidayRouter from "./modules/holidays/publicHoliday.routes.js";
import vehicleRouter from "./modules/vehicles/vehicle.routes.js";
import { initializeItemNameIndex } from "./modules/items/itemIndexReadiness.js";
import { initializeVehicleIndexes } from "./modules/vehicles/vehicleIndexReadiness.js";
import { initializeDefaultVehiclePolicy } from "./modules/vehicles/vehicle.service.js";

import errorMiddleware from "./middlewares/error.middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

// ============================================
// SECURITY MIDDLEWARE (NEW)
// ============================================

// 1. Helmet — Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// 2. CORS — Restricted to known origins (FIXED from origin: true)
const allowedOrigins = [
  process.env.FRONTEND_LOCAL_URL,
  process.env.FRONTEND_API_URL,
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  }),
);

// 3. Rate Limiting — Prevent API abuse
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: {
//     success: false,
//     message: "Too many requests from this IP. Please try again later.",
//   },
//   skip: (req) => req.path === "/health",
// });
// app.use("/api/", limiter);

// Stricter rate limit for auth endpoints
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 10,
//   message: {
//     success: false,
//     message: "Too many login attempts. Please try again after 15 minutes.",
//   },
// });
// app.use("/api/v1/auth/login", authLimiter);
// app.use("/api/v1/auth/forgot-password", authLimiter);

// ============================================
// BODY PARSING
// ============================================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// ============================================
// ROUTES
// ============================================
app.use("/api/v1/users", userRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/employees", employeeRouter);
app.use("/api/v1/customers", customerRouter);
app.use("/api/v1/atm", atmRouter);
app.use("/api/v1/districts", districtRouter);
app.use("/api/v1/regions", regionRouter);
app.use("/api/v1/jobs", jobRouter);
app.use("/api/v1/photos", jobPhotoRouter);
app.use("/api/v1/complaints", complaintRouter);
app.use("/api/v1/dashboard", dashboardRouter);
app.use("/api/v1/banks", bankRouter);
app.use("/api/v1/amc", amcRouter);
app.use("/api/v1/amc-photos", amcPhotoRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/supervisor", supervisorRouter);
app.use("/api/v1/items", itemRouter);
app.use("/api/v1/attendance", attendanceRouter);
app.use("/api/v1/holidays", publicHolidayRouter);
app.use("/api/v1/vehicles", vehicleRouter);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Error middleware
app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;
let shutdownRunningServer = async () => {};

export const startServer = async () => {
  let httpServer;
  let cleanupCronJobs = async () => {};
  let shutdownPromise;
  let httpClosePromise;
  let shutdownRequested = false;
  let startupFinished = false;
  let finishStartup;
  const startupComplete = new Promise((resolve) => {
    finishStartup = () => {
      if (startupFinished) return;
      startupFinished = true;
      resolve();
    };
  });

  const stopAcceptingHttp = () => {
    if (httpClosePromise) return httpClosePromise;

    if (!httpServer?.listening) return Promise.resolve(null);

    httpClosePromise = new Promise((resolve) => {
      try {
        httpServer.close((error) => resolve(error ?? null));
      } catch (error) {
        resolve(error);
      }
    });

    return httpClosePromise;
  };

  const shutdown = () => {
    shutdownRequested = true;
    stopAcceptingHttp();

    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        await startupComplete;

        const cleanupErrors = [];
        const attemptCleanup = async (cleanup) => {
          try {
            await cleanup();
          } catch (error) {
            cleanupErrors.push(error);
          }
        };

        stopAcceptingHttp();
        await attemptCleanup(cleanupCronJobs);
        await attemptCleanup(closeSocketConnections);
        await attemptCleanup(async () => {
          const error = await stopAcceptingHttp();
          if (error) throw error;
        });
        if (mongoose.connection.readyState !== 0) {
          await attemptCleanup(() => mongoose.disconnect());
        }

        if (cleanupErrors.length) {
          throw new AggregateError(cleanupErrors, "Graceful shutdown failed");
        }
      })();
    }

    return shutdownPromise;
  };

  shutdownRunningServer = shutdown;

  const stopStartupIfRequested = async () => {
    if (!shutdownRequested) return false;
    finishStartup();
    await shutdown();
    return true;
  };

  try {
    await connectDb();
    if (await stopStartupIfRequested()) return;

    await initializeDatabaseIndexes();
    if (await stopStartupIfRequested()) return;

    await initializeItemNameIndex();
    if (await stopStartupIfRequested()) return;

    await initializeVehicleIndexes();
    if (await stopStartupIfRequested()) return;

    await initializeDefaultVehiclePolicy();
    if (await stopStartupIfRequested()) return;

    httpServer = http.createServer(app);
    initSocketServer(httpServer, { allowedOrigins });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.removeListener("listening", onListening);
        reject(error);
      };

      const onListening = () => {
        httpServer.removeListener("error", onError);
        resolve();
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(PORT);
    });
    if (await stopStartupIfRequested()) return;

    console.log(`Server is running on port ${PORT}`);

    cleanupCronJobs = await initCronJobs();
    if (await stopStartupIfRequested()) return;

    finishStartup();
    return httpServer;
  } catch (error) {
    finishStartup();

    try {
      await shutdown();
    } catch (cleanupError) {
      console.error("[Startup] Cleanup failed:", cleanupError);
    }

    throw error;
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  let signalHandled = false;
  const handleShutdownSignal = (signal) => {
    if (signalHandled) return;
    signalHandled = true;

    void shutdownRunningServer().then(
      () => {
        console.log(`[Shutdown] Completed after ${signal}`);
      },
      (error) => {
        console.error(`[Shutdown] Failed after ${signal}:`, error);
        process.exitCode = 1;
      },
    );
  };

  process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
  process.on("SIGINT", () => handleShutdownSignal("SIGINT"));

  startServer().catch((error) => {
    console.error("Application startup failed:", error);
    process.exitCode = 1;
  });
}

export default app;
