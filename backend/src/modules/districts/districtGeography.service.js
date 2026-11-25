import mongoose from "mongoose";
import Bank from "../banks/bank.model.js";
import District from "./district.models.js";
import Region from "../region/region.model.js";

export const withGeographyFence = async (
  { bankIds = [], regionIds = [], districtIds = [] },
  operation,
) => {
  const session = await mongoose.startSession();
  const uniqueBankIds = [
    ...new Set(bankIds.map((id) => String(id)).filter(Boolean)),
  ].sort();
  const uniqueRegionIds = [
    ...new Set(regionIds.map((id) => String(id)).filter(Boolean)),
  ].sort();
  const uniqueDistrictIds = [
    ...new Set(districtIds.map((id) => String(id)).filter(Boolean)),
  ].sort();

  try {
    return await session.withTransaction(async () => {
      for (const bankId of uniqueBankIds) {
        const result = await Bank.updateOne(
          { _id: bankId },
          { $inc: { geographyFence: 1 } },
          { session, timestamps: false },
        );
        if (result.matchedCount !== 1) {
          throw new Error(`Geography fence bank ${bankId} not found`);
        }
      }

      for (const regionId of uniqueRegionIds) {
        const result = await Region.updateOne(
          { _id: regionId },
          { $inc: { geographyFence: 1 } },
          { session, timestamps: false },
        );
        if (result.matchedCount !== 1) {
          throw new Error(`Geography fence region ${regionId} not found`);
        }
      }

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

export const withDistrictGeographyFence = (districtIds, operation) =>
  withGeographyFence({ districtIds }, operation);
