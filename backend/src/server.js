import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import connectDb from "./config/db.js";
import authRouter from "./modules/auth/auth.routes.js";
import userRouter from "./modules/users/user.routes.js";
import ATM_routes from "./modules/atms/atm.routes.js";
import employeeRouter from "./modules/employees/employee.routes.js";
import districtRouter from "./modules/districts/district.route.js";
import regionRouter from "./modules/region/region.routes.js";
import customerRouter from "./modules/customers/customer.routes.js";
import errorMiddleware from "./middlewares/error.middleware.js";
import jobPhotoRouter from "./modules/jobPhotos/jobPhotos.route.js";
import { initCronJobs } from "./config/cronJobs.js";
dotenv.config();

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World lets do it day one with the one!");
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/employees", employeeRouter);
app.use("/api/v1/atm", ATM_routes);
app.use("/api/v1/districts", districtRouter);
app.use("/api/v1/regions", regionRouter);
app.use("/api/v1/customers", customerRouter);
app.use("/api/v1/photos", jobPhotoRouter);

app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  connectDb();
  initCronJobs();
  console.log(`Server is running on port ${PORT}`);
});
