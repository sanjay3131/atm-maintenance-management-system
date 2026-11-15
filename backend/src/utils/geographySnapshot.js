import ApiError from "./ApiError.js";
import Bank from "../modules/banks/bank.model.js";
import Region from "../modules/region/region.model.js";
import District from "../modules/districts/district.models.js";

const queryWithSession = (query, session) =>
  session ? query.session(session) : query;

const referenceId = (value) => value?._id ?? value;

export const captureATMGeographySnapshot = async (atm, session) => {
  if (atm.geographyStatus !== "MAPPED") {
    throw new ApiError(409, "ATM geography has not been mapped and approved");
  }
  const bank = await queryWithSession(
    Bank.findById(referenceId(atm.bankId)).select("_id bankName isActive"),
    session,
  );
  const region = await queryWithSession(
    Region.findById(referenceId(atm.regionId)).select(
      "_id name bankId geographyStatus",
    ),
    session,
  );
  const district = await queryWithSession(
    District.findById(referenceId(atm.districtId)).select(
      "_id bankId districtName regionId geographyStatus",
    ),
    session,
  );
  if (!bank || !region || !district) {
    throw new ApiError(
      409,
      "ATM geography is incomplete; assign a valid bank, region, and district before creating operational records",
    );
  }
  if (
    !bank.isActive ||
    region.geographyStatus !== "MAPPED" ||
    district.geographyStatus !== "MAPPED" ||
    String(region.bankId) !== String(bank._id) ||
    String(district.regionId) !== String(region._id) ||
    String(district.bankId) !== String(region.bankId) ||
    String(district.bankId) !== String(bank._id)
  ) {
    throw new ApiError(
      409,
      "ATM geography is inconsistent; correct the bank-region-district hierarchy before creating operational records",
    );
  }

  return {
    bankId: bank._id,
    bankName: bank.bankName,
    regionId: region._id,
    regionName: region.name,
    districtId: district._id,
    districtName: district.districtName,
    capturedAt: new Date(),
  };
};
