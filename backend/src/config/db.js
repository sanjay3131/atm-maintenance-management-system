import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL);

    console.log("MongoDB connected successfully", process.env.MONGODB_URL);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
};

export default connectDb;
