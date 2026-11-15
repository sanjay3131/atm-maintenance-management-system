import mongoose from "mongoose";

const districtTransferAuditSchema = new mongoose.Schema(
  {
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
      index: true,
      immutable: true,
    },
    fromRegionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      required: true,
      immutable: true,
    },
    fromRegionName: { type: String, required: true, immutable: true },
    toRegionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Region",
      required: true,
      immutable: true,
    },
    toRegionName: { type: String, required: true, immutable: true },
    reason: { type: String, required: true, trim: true, immutable: true },
    affectedATMCount: { type: Number, required: true, immutable: true },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

districtTransferAuditSchema.index({ districtId:  1, createdAt: -1 });

const DistrictTransferAudit = mongoose.model(
  "DistrictTransferAudit",
  districtTransferAuditSchema,
);

export default DistrictTransferAudit;
