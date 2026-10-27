import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["amc_overdue", "amc_completed", "amc_generated", "system"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Optional per-recipient idempotency key; legacy documents do not have it.
    dedupeKey: {
      type: String,
      trim: true,
      select: false,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ "data.amcId": 1, type: 1 }, { sparse: true });
notificationSchema.index(
  { userId: 1, type: 1, "data.amcId": 1 },
  { unique: true, partialFilterExpression: { type: "amc_overdue" } },
);

// Partial so legacy documents without a dedupeKey are never indexed.
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  {
    unique: true,
    name: "userId_1_dedupeKey_1_unique",
    partialFilterExpression: { dedupeKey: { $type: "string" } },
  },
);

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
