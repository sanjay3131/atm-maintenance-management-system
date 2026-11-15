import mongoose from "mongoose";
import District from "./district.models.js";

export const withDistrictGeographyFence = async (districtIds, operation) => {
  const session = await mongoose.startSession();
  const uniqueDistrictIds = [
    ...new Set(districtIds.map((id) => String(id)).filter(Boolean)),
  ].sort();

  try {
    return await session.withTransaction(async () => {
      for (const districtId of uniqueDistrictIds) {
        const result = await District.updateOne(
          { _id: districtId },
          { $inc: { geographyFence: 1 } },
          { session, timestamps: false },
        );
        if (result.matchedCount !== 1) {
          throw new Error(`Geography fence district ${districtId} not found`);
        }
      }

      return operation(session);
    });
  } finally {
    await session.endSession();
  }
};
