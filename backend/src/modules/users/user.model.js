import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
    },
    userType: {
      type: String,
      enum: ["admin", "customer", "employee", "superAdmin", "user"],
      default: "user",
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    avatar: {
      url: String,
      publicId: String,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "pending"],
      default: "active",
    },
    lastLogin: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    refreshToken: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);
userSchema.index({ roleId: 1 });

userSchema.index({ status: 1 });

const User = mongoose.model("User", userSchema);

export default User;
