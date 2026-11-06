import mongoose from "mongoose";

const vehicleAssignmentSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    assignedAt: { type: Date, required: true, default: Date.now },
    unassignedAt: { type: Date, default: null },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true },
);

vehicleAssignmentSchema.index(
  { vehicleId: 1 },
  {
    unique: true,
    name: "vehicleId_active_assignment_unique",
    partialFilterExpression: { unassignedAt: null },
  },
);
vehicleAssignmentSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    name: "employeeId_active_vehicle_assignment_unique",
    partialFilterExpression: { unassignedAt: null },
  },
);
vehicleAssignmentSchema.index({ vehicleId: 1, assignedAt: -1 });
vehicleAssignmentSchema.index({ employeeId: 1, assignedAt: -1 });

const VehicleAssignment = mongoose.model(
  "VehicleAssignment",
  vehicleAssignmentSchema,
);

export default VehicleAssignment;
