import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import connectDb from "./config/db.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(cookieParser());

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World lets do it day one  with the one!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  connectDb();
  console.log(`Server is running on port ${PORT}`);
});
