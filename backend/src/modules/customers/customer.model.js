const customerSchema = new mongoose.Schema(
  {
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    customerRegion: {
      type: String,
      required: true,
      trim: true,
    },
    district: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

customerSchema.index({ customerEmail: 1 });

customerSchema.index({ customerPhone: 1 });

const Customer = mongoose.model("Customer", customerSchema);
