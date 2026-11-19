import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { ChevronDown, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Bank } from "@/features/banks/types/bank.types";
import { useATMs } from "@/features/atms/hooks/useATMs";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import type { ATM } from "@/features/atms/types/atm.types";
import { useAddCustomerATMs } from "../hooks/useAdminCustomers";
import { useCustomer } from "../hooks/useCustomer";
import { useRegionsByBank } from "@/features/users/hooks/useRegionsByBank";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import {
  addATMIds,
  areAllVisibleATMsSelected,
  filterEligibleATMs,
  getCustomerDistrictIds,
  getATMFilterOptions,
  getATMReferenceName,
  getEligibleAvailableATMs,
  getValidAvailableATMs,
  getValidCustomerATMs,
  removeVisibleATMIds,
  type ATMSelectionFilters,
} from "../utils/customerATMAssignments";
import type {
  CustomerGeographyBank,
  CustomerGeographyDistrict,
  CustomerGeographyRegion,
  CustomerListItem,
  CustomerUpdateData,
} from "../services/customer.service";

type CustomerEditValues = Pick<
  CustomerListItem,
  "_id" | "customerName" | "customerPhone" | "bankName"
>;

const LEGACY_BANK_OPTION = "__legacy_bank__";

const getReferenceId = (
  value:
    | string
    | CustomerGeographyBank
    | CustomerGeographyRegion
    | CustomerGeographyDistrict
    | null
    | undefined,
) => (typeof value === "string" ? value : value?._id ?? "");

const getReferenceName = (
  value:
    | CustomerGeographyBank
    | CustomerGeographyRegion
    | CustomerGeographyDistrict
    | string
    | null
    | undefined,
) => {
  if (!value) return "";
  if (typeof value === "string") return "";
  if ("bankName" in value) return value.bankName;
  if ("districtName" in value) return value.districtName;
  return value.name;
};

interface CustomerEditDialogProps {
  open: boolean;
  customer: CustomerEditValues | null;
  banks: Bank[];
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: CustomerUpdateData) => Promise<void>;
}

export default function CustomerEditDialog({
  open,
  customer,
  banks,
  isSaving,
  onOpenChange,
  onSave,
}: CustomerEditDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] min-h-0 w-[calc(100vw-2rem)] flex-col overflow-hidden p-4 sm:p-6">
        <div className="shrink-0 space-y-2">
          <DialogTitle>Edit customer</DialogTitle>
          <DialogDescription>
            Update customer profile, geography, and ATM assignments.
          </DialogDescription>
        </div>
        {customer && (
          <CustomerEditForm
            key={customer._id}
            customer={customer}
            banks={banks}
            isSaving={isSaving}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerEditForm({
  customer,
  banks,
  isSaving,
  onCancel,
  onSave,
}: {
  customer: CustomerEditValues;
  banks: Bank[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: CustomerEditDialogProps["onSave"];
}) {
  const [customerName, setCustomerName] = useState(customer.customerName);
  const [customerPhone, setCustomerPhone] = useState(customer.customerPhone);
  const [bankIdDraft, setBankIdDraft] = useState<string | null>(null);
  const [regionIdsDraft, setRegionIdsDraft] = useState<string[] | null>(null);
  const [serviceDistrictIdsDraft, setServiceDistrictIdsDraft] = useState<
    string[] | null
  >(null);
  const [geographyEdited, setGeographyEdited] = useState(false);
  const {
    data: customerDetails,
    isLoading: isCustomerDetailsLoading,
    isError: isCustomerDetailsError,
    refetch: refetchCustomerDetails,
  } = useCustomer(customer._id);
  const legacyBankName =
    customerDetails?.bankName || customer.bankName || "";
  const matchingLegacyBank = banks.find(
    (bank) =>
      bank.bankName.toLowerCase() === legacyBankName.toLowerCase() ||
      bank.bankCode.toLowerCase() === legacyBankName.toLowerCase(),
  );
  const currentBankId =
    getReferenceId(customerDetails?.bankId) ||
    matchingLegacyBank?._id ||
    (legacyBankName ? LEGACY_BANK_OPTION : "");
  const bankId = bankIdDraft ?? currentBankId;
  const bankIdForQueries =
    bankId === LEGACY_BANK_OPTION ? "" : bankId;
  const currentRegionIds =
    customerDetails?.regionIds?.map(getReferenceId) ??
    (getReferenceId(customerDetails?.regionId)
      ? [getReferenceId(customerDetails?.regionId)]
      : []);
  const currentServiceDistrictIds =
    customerDetails?.serviceDistrictIds?.map(getReferenceId) ??
    (getReferenceId(customerDetails?.districtId)
      ? [getReferenceId(customerDetails?.districtId)]
      : []);
  const regionIds = regionIdsDraft ?? currentRegionIds;
  const serviceDistrictIds =
    serviceDistrictIdsDraft ?? currentServiceDistrictIds;
  const {
    data: regions = [],
    isLoading: areRegionsLoading,
    isError: areRegionsError,
    refetch: refetchRegions,
  } = useRegionsByBank(bankIdForQueries);
  const {
    data: districts = [],
    isLoading: areDistrictsLoading,
    isError: areDistrictsError,
    refetch: refetchDistricts,
  } = useDistricts(regionIds.length > 0, regionIds);
  const activeBanks = banks.filter((bank) => bank.isActive);
  const activeRegions = regions.filter((region) => region.isActive);
  const activeDistricts = districts.filter((district) => district.isActive);
  const regionOptions = [
    ...activeRegions.map((region) => ({
      value: region._id,
      label: region.name,
    })),
    ...regionIds
      .filter((id) => !activeRegions.some((region) => region._id === id))
      .map((id) => {
        const savedRegion =
          customerDetails?.regionIds?.find(
            (region) => getReferenceId(region) === id,
          ) ??
          (getReferenceId(customerDetails?.regionId) === id
            ? customerDetails?.regionId
            : null);
        return {
          value: id,
          label: `${getReferenceName(savedRegion) || "Saved region"} (saved)`,
        };
      }),
  ];
  const districtOptions = [
    ...activeDistricts.map((district) => {
      const regionId = getReferenceId(district.regionId);
      const regionName =
        regions.find((region) => region._id === regionId)?.name ||
        getReferenceName(district.regionId) ||
        "Selected region";
      return {
        value: district._id,
        label: district.districtName,
        group: regionName,
      };
    }),
    ...serviceDistrictIds
      .filter(
        (id) => !activeDistricts.some((district) => district._id === id),
      )
      .map((id) => {
        const savedDistrict =
          customerDetails?.serviceDistrictIds?.find(
            (district) => getReferenceId(district) === id,
          ) ??
          (getReferenceId(customerDetails?.districtId) === id
            ? customerDetails?.districtId
            : null);
        const regionName =
          typeof savedDistrict === "object" && savedDistrict
            ? getReferenceName(savedDistrict.regionId)
            : "";
        return {
          value: id,
          label: `${getReferenceName(savedDistrict) || "Saved district"} (saved)`,
          group: regionName || "Saved selections",
        };
      }),
  ];
  const selectedBankName =
    banks.find((bank) => bank._id === bankId)?.bankName ||
    getReferenceName(customerDetails?.bankId) ||
    legacyBankName;
  const geographyControlsDisabled =
    isSaving || isCustomerDetailsLoading || isCustomerDetailsError;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(customer._id, {
      customerName,
      customerPhone,
      ...(geographyEdited
        ? {
            bankId:
              bankId && bankId !== LEGACY_BANK_OPTION ? bankId : null,
            regionIds,
            serviceDistrictIds,
          }
        : {}),
    });
  };

  return (
    <form
      className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-auto pr-1">
        <div>
          <label
            htmlFor="customer-edit-name"
            className="mb-2 block text-sm font-medium"
          >
            Customer name
          </label>
          <input
            id="customer-edit-name"
            required
            minLength={1}
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <div>
          <label
            htmlFor="customer-edit-phone"
            className="mb-2 block text-sm font-medium"
          >
            Phone number
          </label>
          <input
            id="customer-edit-phone"
            type="tel"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Customer geography</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This reference assignment does not change the customer&apos;s
              existing ATM district scope.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="customer-edit-bank"
                className="mb-2 block text-sm font-medium"
              >
                Bank
              </label>
              <select
                id="customer-edit-bank"
                value={bankId}
                onChange={(event) => {
                  const nextBankId = event.target.value;
                  setBankIdDraft(nextBankId);
                  setRegionIdsDraft([]);
                  setServiceDistrictIdsDraft([]);
                  setGeographyEdited(true);
                }}
                disabled={geographyControlsDisabled}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">No bank specified</option>
                {bankId === LEGACY_BANK_OPTION && (
                  <option value={LEGACY_BANK_OPTION} disabled>
                    {legacyBankName} (legacy value)
                  </option>
                )}
                {bankId &&
                  bankId !== LEGACY_BANK_OPTION &&
                  !activeBanks.some((bank) => bank._id === bankId) && (
                    <option value={bankId} disabled>
                      {selectedBankName || "Current bank unavailable"}
                      {banks.some((bank) => bank._id === bankId)
                        ? " (inactive)"
                        : ""}
                    </option>
                  )}
                {activeBanks.map((bank) => (
                  <option key={bank._id} value={bank._id}>
                    {bank.bankName}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <SearchableCheckboxMultiSelect
                id="customer-edit-region"
                label="Regions"
                options={regionOptions}
                selectedValues={regionIds}
                onChange={(nextRegionIds) => {
                  const nextRegionIdSet = new Set(nextRegionIds);
                  setRegionIdsDraft(nextRegionIds);
                  setServiceDistrictIdsDraft(
                    serviceDistrictIds.filter((districtId) => {
                      const district =
                        districts.find((item) => item._id === districtId) ??
                        customerDetails?.serviceDistrictIds?.find(
                          (item) => getReferenceId(item) === districtId,
                        ) ??
                        (getReferenceId(customerDetails?.districtId) ===
                        districtId
                          ? customerDetails?.districtId
                          : null);
                      const districtRegionId =
                        typeof district === "object" && district
                          ? getReferenceId(district.regionId)
                          : "";
                      return (
                        !districtRegionId ||
                        nextRegionIdSet.has(districtRegionId)
                      );
                    }),
                  );
                  setGeographyEdited(true);
                }}
                disabled={geographyControlsDisabled || !bankIdForQueries}
                isLoading={areRegionsLoading}
                emptyMessage="No active regions are available for this bank."
                placeholder="Choose regions"
              />
              {!bankIdForQueries && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Select a bank to choose regions.
                </p>
              )}
              {areRegionsError && (
                <p className="mt-1 text-xs text-destructive">
                  Regions could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void refetchRegions()}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>

            <div className="min-w-0">
              <SearchableCheckboxMultiSelect
                id="customer-edit-service-district"
                label="Service districts"
                options={districtOptions}
                selectedValues={serviceDistrictIds}
                onChange={(nextServiceDistrictIds) => {
                  setServiceDistrictIdsDraft(nextServiceDistrictIds);
                  setGeographyEdited(true);
                }}
                disabled={
                  geographyControlsDisabled || regionIds.length === 0
                }
                isLoading={areDistrictsLoading}
                emptyMessage="No active districts are available for the selected regions."
                placeholder="Choose service districts"
              />
              {!regionIds.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Select at least one region to choose service districts.
                </p>
              )}
              {areDistrictsError && (
                <p className="mt-1 text-xs text-destructive">
                  Districts could not be loaded.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void refetchDistricts()}
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>
          </div>
          {isCustomerDetailsError && (
            <p className="text-xs text-destructive">
              Current customer geography could not be loaded.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => void refetchCustomerDetails()}
              >
                Retry
              </button>
            </p>
          )}
        </div>

        <CustomerATMAssignments customerId={customer._id} banks={banks} />
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t bg-background pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

interface GeographyMultiSelectOption {
  value: string;
  label: string;
  group?: string;
}

function SearchableCheckboxMultiSelect({
  id,
  label,
  options,
  selectedValues,
  onChange,
  disabled,
  isLoading,
  emptyMessage,
  placeholder,
}: {
  id: string;
  label: string;
  options: GeographyMultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  isLoading: boolean;
  emptyMessage: string;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedIds = new Set(selectedValues);
  const normalizedSearch = searchValue.trim().toLocaleLowerCase();
  const filteredOptions = options.filter(
    (option) =>
      option.label.toLocaleLowerCase().includes(normalizedSearch) ||
      option.group?.toLocaleLowerCase().includes(normalizedSearch),
  );
  const groupedOptions = new Map<string, GeographyMultiSelectOption[]>();

  for (const option of filteredOptions) {
    const group = option.group ?? "";
    const groupOptions = groupedOptions.get(group) ?? [];
    groupOptions.push(option);
    groupedOptions.set(group, groupOptions);
  }

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const removeValue = (value: string) =>
    onChange(selectedValues.filter((selected) => selected !== value));

  return (
    <div
      ref={rootRef}
      className="space-y-2"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setIsOpen(false);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-sm font-medium">
          {label}
        </span>
        <span
          id={`${id}-count`}
          className="text-xs text-muted-foreground"
          aria-live="polite"
        >
          {selectedValues.length} selected
        </span>
      </div>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="h-auto min-h-9 w-full justify-between gap-2 px-3 py-2 text-left whitespace-normal"
        disabled={disabled}
        aria-label={`${label}: ${selectedValues.length} selected`}
        aria-expanded={isOpen}
        aria-controls={`${id}-options`}
        aria-describedby={`${id}-count`}
        onClick={() => {
          setIsOpen((current) => !current);
          setSearchValue("");
        }}
      >
        <span className="min-w-0 truncate">
          {selectedValues.length ? placeholder.replace("Choose", "Edit") : placeholder}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </Button>
      {selectedValues.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label={`Selected ${label.toLocaleLowerCase()}`}
        >
          {selectedValues.map((value) => {
            const option = options.find((item) => item.value === value);
            return (
              <Badge
                key={value}
                variant="secondary"
                className="gap-1 pr-1"
              >
                <span>{option?.label ?? value}</span>
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${option?.label ?? value}`}
                  onClick={() => removeValue(value)}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
      {isOpen && (
        <div
          id={`${id}-options`}
          className="z-50 mt-1 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md"
          role="region"
          aria-labelledby={`${id}-label`}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={`Search ${label.toLocaleLowerCase()}...`}
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div
            className="mt-2 max-h-52 overflow-y-auto"
            role="group"
            aria-label={`${label} options`}
          >
            {isLoading ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground" role="status">
                Loading {label.toLocaleLowerCase()}...
              </p>
            ) : options.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground" role="status">
                {emptyMessage}
              </p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground" role="status">
                No results found.
              </p>
            ) : (
              [...groupedOptions].map(([group, groupOptions]) => (
                <div key={group || "ungrouped"} className="py-1">
                  {group && (
                    <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                      {group}
                    </p>
                  )}
                  {groupOptions.map((option) => (
                    <label
                      key={option.value}
                      htmlFor={`${id}-option-${option.value}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted focus-within:bg-muted"
                    >
                      <input
                        id={`${id}-option-${option.value}`}
                        type="checkbox"
                        checked={selectedIds.has(option.value)}
                        disabled={isLoading}
                        onChange={() => {
                          const nextValues = selectedIds.has(option.value)
                            ? selectedValues.filter(
                                (value) => value !== option.value,
                              )
                            : [...selectedValues, option.value];
                          onChange(nextValues);
                        }}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0 break-words">{option.label}</span>
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerATMAssignments({
  customerId,
  banks,
}: {
  customerId: string;
  banks: Bank[];
}) {
  const {
    data: customer,
    isLoading: isCustomerLoading,
    isError: isCustomerError,
    refetch: refetchCustomer,
  } = useCustomer(customerId);
  const {
    data: atms = [],
    isLoading: areATMsLoading,
    isError: areATMsError,
    refetch: refetchATMs,
  } = useATMs();
  const assignmentMutation = useAddCustomerATMs();
  const [selectedATMIds, setSelectedATMIds] = useState<string[]>([]);
  const [atmFilters, setATMFilters] = useState<ATMSelectionFilters>({
    search: "",
    bankId: "",
    districtId: "",
    regionId: "",
  });
  const assignedATMs = getValidCustomerATMs(customer?.atmIds ?? []);
  const missingAssignedATMCount =
    (customer?.atmIds.length ?? 0) - assignedATMs.length;
  const assignedIds = new Set(assignedATMs.map((atm) => atm._id));
  const customerBankName = customer?.bankName?.toLowerCase();
  const customerBank = banks.find(
    (bank) =>
      bank.isActive &&
      (bank.bankName.toLowerCase() === customerBankName ||
        bank.bankCode.toLowerCase() === customerBankName),
  );
  const eligibleCustomerBankId =
    customer?.isActive && !customer.isDeleted ? customerBank?._id : undefined;
  const availableATMs = getValidAvailableATMs(atms, assignedIds);
  const customerDistrictIds = getCustomerDistrictIds(
    customer?.districtIds ?? [],
  );
  const eligibleATMs = getEligibleAvailableATMs(
    availableATMs,
    assignedIds,
    eligibleCustomerBankId,
    customerDistrictIds,
  );
  const filteredATMs = filterEligibleATMs(eligibleATMs, atmFilters);
  const bankOptions = getATMFilterOptions(availableATMs, "bankId");
  const districtOptions = getATMFilterOptions(availableATMs, "districtId");
  const regionOptions = getATMFilterOptions(availableATMs, "regionId");
  const allVisibleSelected = areAllVisibleATMsSelected(
    selectedATMIds,
    filteredATMs,
  );
  const selectedEligibleATMIds = eligibleATMs
    .filter((atm) => selectedATMIds.includes(atm._id))
    .map((atm) => atm._id);
  const hasATMFilters = Object.values(atmFilters).some(Boolean);

  const clearATMFilters = () =>
    setATMFilters({ search: "", bankId: "", districtId: "", regionId: "" });

  const submitAssignments = () => {
    assignmentMutation.mutate(
      {
        id: customerId,
        atmIds: selectedEligibleATMIds,
      },
      { onSuccess: () => setSelectedATMIds([]) },
    );
  };

  return (
    <section className="space-y-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">ATM assignments</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Select additional ATMs to add; this does not replace existing
          assignments. ATMs already owned by another customer will be
          reassigned, while their historical records remain unchanged. ATMs
          cannot be left without a customer.
        </p>
      </div>

      {isCustomerLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading assigned ATMs...
        </p>
      ) : isCustomerError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span>Assigned ATMs could not be loaded.</span>
          <button
            type="button"
            className="underline"
            onClick={() => void refetchCustomer()}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="rounded-md border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Currently assigned ({assignedATMs.length})
          </p>
          {missingAssignedATMCount > 0 && (
            <p className="mb-2 text-xs text-muted-foreground" role="status">
              {missingAssignedATMCount} linked ATM record(s) could not be
              loaded. Existing assignments are unchanged.
            </p>
          )}
          {assignedATMs.length ? (
            <ul className="space-y-1 text-sm">
              {assignedATMs.map((atm) => (
                <li key={atm._id}>
                  {getATMDisplayId(atm)} —{" "}
                  {getATMReferenceName(atm.bankId) ?? "Unknown bank"}
                  {getATMReferenceName(atm.districtId)
                    ? `, ${getATMReferenceName(atm.districtId)}`
                    : ""}
                  {getATMReferenceName(atm.regionId)
                    ? `, ${getATMReferenceName(atm.regionId)}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No ATMs are currently assigned.
            </p>
          )}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Add ATMs
        </p>
        {areATMsLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading available ATMs...
          </p>
        ) : areATMsError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>Available ATMs could not be loaded.</span>
            <button
              type="button"
              className="underline"
              onClick={() => void refetchATMs()}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="customer-atm-search" className="sr-only">
              Search available ATMs
            </label>
            <input
              id="customer-atm-search"
              type="search"
              value={atmFilters.search}
              onChange={(event) =>
                setATMFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Search ATM, bank, district, or region"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ATMFilterSelect
                id="customer-atm-bank-filter"
                label="Bank"
                value={atmFilters.bankId}
                options={bankOptions}
                onChange={(bankId) =>
                  setATMFilters((current) => ({ ...current, bankId }))
                }
              />
              <ATMFilterSelect
                id="customer-atm-district-filter"
                label="District"
                value={atmFilters.districtId}
                options={districtOptions}
                onChange={(districtId) =>
                  setATMFilters((current) => ({ ...current, districtId }))
                }
              />
              <ATMFilterSelect
                id="customer-atm-region-filter"
                label="Region"
                value={atmFilters.regionId}
                options={regionOptions}
                onChange={(regionId) =>
                  setATMFilters((current) => ({ ...current, regionId }))
                }
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground" role="status">
                {filteredATMs.length} eligible ATM(s) match
                {allVisibleSelected && " · all selected"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={clearATMFilters}
                  disabled={!hasATMFilters}
                >
                  Clear filters
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedATMIds((current) =>
                      addATMIds(current, filteredATMs),
                    )
                  }
                  disabled={
                    filteredATMs.length === 0 ||
                    allVisibleSelected ||
                    assignmentMutation.isPending
                  }
                >
                  {allVisibleSelected
                    ? "All visible selected"
                    : "Select all eligible"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedATMIds((current) =>
                      removeVisibleATMIds(current, filteredATMs),
                    )
                  }
                  disabled={
                    !filteredATMs.some((atm) =>
                      selectedATMIds.includes(atm._id),
                    ) || assignmentMutation.isPending
                  }
                >
                  Clear visible selection
                </Button>
              </div>
            </div>
            {filteredATMs.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {eligibleATMs.length === 0
                  ? !customer?.isActive || customer.isDeleted
                    ? "Only active customers can receive ATM assignments."
                    : "No eligible active ATMs are available for this customer's bank and district."
                  : "No eligible ATMs match the current search and filters."}
              </p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto overscroll-y-auto rounded-md border p-2">
                {filteredATMs.map((atm) => (
                  <ATMSelectionRow
                    key={atm._id}
                    atm={atm}
                    selected={selectedATMIds.includes(atm._id)}
                    onChange={(checked) =>
                      setSelectedATMIds((current) =>
                        checked
                          ? addATMIds(current, [atm])
                          : removeVisibleATMIds(current, [atm]),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {assignmentMutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          {isAxiosError<{ message?: string }>(assignmentMutation.error)
            ? (assignmentMutation.error.response?.data?.message ??
              "ATM assignments could not be saved.")
            : assignmentMutation.error.message ||
              "ATM assignments could not be saved."}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {selectedATMIds.length} additional ATM(s) selected
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void submitAssignments()}
          disabled={
            selectedEligibleATMIds.length === 0 ||
            assignmentMutation.isPending ||
            isCustomerLoading ||
            isCustomerError
          }
        >
          {assignmentMutation.isPending
            ? "Adding ATMs..."
            : "Add selected ATMs"}
        </Button>
      </div>
    </section>
  );
}

function ATMFilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 text-xs">
      <span className="mb-1 block font-medium">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
      >
        <option value="">All {label.toLowerCase()}s</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ATMSelectionRow({
  atm,
  selected,
  onChange,
}: {
  atm: ATM;
  selected: boolean;
  onChange: (checked: boolean) => void;
}) {
  const owner =
    atm.customer && typeof atm.customer === "object"
      ? atm.customer.customerName
      : atm.customer
        ? "another customer"
        : "unassigned";

  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-muted/50">
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        <span className="font-medium">{getATMDisplayId(atm)}</span>
        <span className="block text-xs text-muted-foreground">
          {getATMReferenceName(atm.bankId) ?? "Unknown bank"}
          {getATMReferenceName(atm.districtId)
            ? ` · ${getATMReferenceName(atm.districtId)}`
            : ""}
          {getATMReferenceName(atm.regionId)
            ? ` · ${getATMReferenceName(atm.regionId)}`
            : ""}
          {` · ${atm.status.replaceAll("_", " ")}`}
          {` · ${owner === "unassigned" ? "Unassigned" : `Currently assigned to ${owner}`}`}
        </span>
      </span>
    </label>
  );
}
