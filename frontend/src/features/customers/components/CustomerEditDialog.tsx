import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/features/banks/types/bank.types";
import { useATMs } from "@/features/atms/hooks/useATMs";
import type { ATM } from "@/features/atms/types/atm.types";
import { useAddCustomerATMs } from "../hooks/useAdminCustomers";
import { useCustomer } from "../hooks/useCustomer";
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
  CustomerListItem,
  CustomerUpdateData,
} from "../services/customer.service";

type CustomerEditValues = Pick<
  CustomerListItem,
  "_id" | "customerName" | "customerPhone" | "bankName"
>;

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
            Update customer profile information and add ATM assignments.
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
  const [bankName, setBankName] = useState(customer.bankName ?? "");
  const bankNames = Array.from(
    new Set([
      ...banks.map((bank) => bank.bankName),
      ...(bankName && !banks.some((bank) => bank.bankName === bankName)
        ? [bankName]
        : []),
    ]),
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(customer._id, { customerName, customerPhone, bankName });
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

        <div>
          <label
            htmlFor="customer-edit-bank"
            className="mb-2 block text-sm font-medium"
          >
            Bank
          </label>
          <select
            id="customer-edit-bank"
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">No bank specified</option>
            {bankNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
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
                  {atm.atmId} —{" "}
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
        <span className="font-medium">{atm.atmId}</span>
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
