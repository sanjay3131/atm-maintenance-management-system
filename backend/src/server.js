import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import path from "path";

import connectDb from "./config/db.js";
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
  "http://localhost:5173",
  "http://localhost:3000",
  "https://yourdomain.com",
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
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// 3. Rate Limiting — Prevent API abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please try again later.",
  },
  skip: (req) => req.path === "/health",
});
app.use("/api/", limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/forgot-password", authLimiter);

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
app.use("/api/v1/atms", atmRouter);
app.use("/api/v1/districts", districtRouter);
app.use("/api/v1/regions", regionRouter);
app.use("/api/v1/jobs", jobRouter);
app.use("/api/v1/photos", jobPhotoRouter);
app.use("/api/v1/complaints", complaintRouter);

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

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      initCronJobs();
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed !!!", err);
  });

export default app;
