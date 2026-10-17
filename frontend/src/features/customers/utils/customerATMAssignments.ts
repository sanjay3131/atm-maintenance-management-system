import type { ATM } from "@/features/atms/types/atm.types";
import type { CustomerAssignedATM } from "../services/customer.service";

export const getValidCustomerATMs = (
  atms: (CustomerAssignedATM | null | undefined)[],
): CustomerAssignedATM[] => {
  const seen = new Set<string>();
  return atms.filter((atm): atm is CustomerAssignedATM => {
    if (
      !atm ||
      typeof atm._id !== "string" ||
      !atm._id ||
      typeof atm.atmId !== "string" ||
      !atm.atmId
    ) {
      return false;
    }
    const id = atm._id.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const getValidAvailableATMs = (
  atms: (ATM | null | undefined)[],
  assignedIds: ReadonlySet<string>,
): ATM[] => {
  const seen = new Set<string>();
  const assigned = new Set([...assignedIds].map((id) => id.toLowerCase()));
  return atms.filter((atm): atm is ATM => {
    if (
      !atm ||
      typeof atm._id !== "string" ||
      !atm._id ||
      typeof atm.atmId !== "string" ||
      !atm.atmId
    ) {
      return false;
    }
    const id = atm._id.toLowerCase();
    if (assigned.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const getATMReferenceId = (
  bank: ATM["bankId"] | null | undefined,
): string | undefined => {
  if (typeof bank === "string") return undefined;
  return bank?._id;
};

export const getATMReferenceName = (
  reference:
    | ATM["bankId"]
    | CustomerAssignedATM["districtId"]
    | CustomerAssignedATM["regionId"]
    | null
    | undefined,
): string | undefined => {
  if (typeof reference !== "object" || reference === null) return undefined;
  if ("bankName" in reference) return reference.bankName;
  if ("districtName" in reference) return reference.districtName;
  if ("name" in reference) return reference.name;
  return undefined;
};

export interface ATMFilterOption {
  id: string;
  label: string;
}

export interface ATMSelectionFilters {
  search: string;
  bankId: string;
  districtId: string;
  regionId: string;
}

const getATMReference = (
  reference:
    | ATM["bankId"]
    | ATM["districtId"]
    | ATM["regionId"]
    | null
    | undefined,
): ATMFilterOption | undefined => {
  if (typeof reference !== "object" || reference === null) return undefined;
  if (typeof reference._id !== "string" || !reference._id) return undefined;
  const label =
    getATMReferenceName(reference) ??
    (typeof reference._id === "string" ? reference._id : undefined);
  return label ? { id: reference._id, label } : undefined;
};

export const getATMFilterOptions = (
  atms: ATM[],
  field: "bankId" | "districtId" | "regionId",
): ATMFilterOption[] => {
  const options = new Map<string, ATMFilterOption>();
  for (const atm of atms) {
    const option = getATMReference(atm[field]);
    if (option && !options.has(option.id)) options.set(option.id, option);
  }
  return [...options.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
};

const getReferenceId = (
  reference: string | { _id: string } | null | undefined,
): string | undefined =>
  typeof reference === "string" ? reference : reference?._id;

export const getCustomerDistrictIds = (
  districts: ({ _id: string } | string | null | undefined)[],
): string[] => [
  ...new Set(
    districts
      .map((district) => getReferenceId(district))
      .filter((id): id is string => Boolean(id)),
  ),
];

export const getEligibleAvailableATMs = (
  atms: (ATM | null | undefined)[],
  assignedIds: ReadonlySet<string>,
  customerBankId: string | undefined,
  customerDistrictIds: readonly string[],
): ATM[] => {
  if (!customerBankId) return [];
  const eligibleDistrictIds = new Set(
    customerDistrictIds.map((id) => id.toLowerCase()),
  );
  return getValidAvailableATMs(atms, assignedIds).filter((atm) => {
    if (
      atm.status !== "ACTIVE" ||
      getReferenceId(atm.bankId)?.toLowerCase() !== customerBankId.toLowerCase()
    ) {
      return false;
    }
    return (
      customerDistrictIds.length === 0 ||
      eligibleDistrictIds.has(
        getReferenceId(atm.districtId)?.toLowerCase() ?? "",
      )
    );
  });
};

export const filterEligibleATMs = (
  atms: ATM[],
  filters: ATMSelectionFilters,
): ATM[] => {
  const search = filters.search.trim().toLocaleLowerCase();
  return atms.filter((atm) => {
    if (
      search &&
      ![
        atm.atmId,
        atm.locationName,
        atm.address,
        getATMReferenceName(atm.bankId),
        getATMReferenceName(atm.districtId),
        getATMReferenceName(atm.regionId),
      ].some((value) => value?.toLocaleLowerCase().includes(search))
    ) {
      return false;
    }

    return (
      (!filters.bankId || getReferenceId(atm.bankId) === filters.bankId) &&
      (!filters.districtId ||
        getReferenceId(atm.districtId) === filters.districtId) &&
      (!filters.regionId || getReferenceId(atm.regionId) === filters.regionId)
    );
  });
};

export const addATMIds = (
  selectedIds: readonly string[],
  visibleATMs: readonly ATM[],
): string[] => {
  const result = [...selectedIds];
  const seen = new Set(selectedIds.map((id) => id.toLowerCase()));
  for (const atm of visibleATMs) {
    const normalizedId = atm._id.toLowerCase();
    if (!seen.has(normalizedId)) {
      result.push(atm._id);
      seen.add(normalizedId);
    }
  }
  return result;
};

export const removeVisibleATMIds = (
  selectedIds: readonly string[],
  visibleATMs: readonly ATM[],
): string[] => {
  const visibleIds = new Set(visibleATMs.map((atm) => atm._id.toLowerCase()));
  return selectedIds.filter((id) => !visibleIds.has(id.toLowerCase()));
};

export const areAllVisibleATMsSelected = (
  selectedIds: readonly string[],
  visibleATMs: readonly ATM[],
): boolean => {
  if (visibleATMs.length === 0) return false;
  const selected = new Set(selectedIds.map((id) => id.toLowerCase()));
  return visibleATMs.every((atm) => selected.has(atm._id.toLowerCase()));
};
