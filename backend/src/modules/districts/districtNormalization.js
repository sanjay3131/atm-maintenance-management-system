export const normalizeDistrictName = (value) => {
  if (typeof value !== "string") {
    throw new TypeError("District name must be a string");
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new TypeError("District name cannot be empty");
  }
  return normalized;
};

export const normalizeDistrictPinCode = (value) => {
  if (typeof value !== "string") {
    throw new TypeError("District PIN code must be a string");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("District PIN code cannot be empty");
  }
  return normalized;
};

export const districtNormalizedValues = ({ districtName, pinCode }) => ({
  districtNameNormalized: normalizeDistrictName(districtName),
  pinCodeNormalized: normalizeDistrictPinCode(pinCode),
});

export const buildDistrictGeographyBackfill = (district, region) => {
  if (
    !district?.regionId ||
    !region?._id ||
    String(district.regionId).toLowerCase() !== String(region._id).toLowerCase() ||
    !region.bankId
  ) {
    throw new TypeError("District Bank must be derived from its valid parent Region");
  }
  return {
    bankId: region.bankId,
    ...districtNormalizedValues(district),
  };
};
