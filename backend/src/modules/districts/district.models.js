const districtSchema = new mongoose.Schema(
  {
    districtName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    pinCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    state: {
      type: String,
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

userSchema.index({ districtName: 1 });

userSchema.index({ pinCode: 1 });

const District = mongoose.model("District", districtSchema);