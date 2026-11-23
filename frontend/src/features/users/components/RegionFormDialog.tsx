import { useEffect } from "react";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBanks } from "@/features/banks/hooks/useBanks";
import type { Bank } from "@/features/banks/types/bank.types";
import {
  useCreateRegion,
  useUpdateRegion,
} from "../hooks/useRegionMutations";
import type { Region } from "../services/region.service";
import {
  regionFormSchema,
  type RegionFormSchemaValues,
} from "../types/region.schema";

function getErrorMessage(
  error: unknown,
  fallback = "Unable to save the region.",
) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function getBankId(bank: Region["bankId"] | undefined, fallback = "") {
  if (typeof bank === "string") return bank || fallback;
  return bank?._id ?? fallback;
}

function formatBankLabel(bank: Pick<Bank, "_id" | "bankName" | "bankCode">) {
  return `${bank.bankName} (${bank.bankCode || "No code"})`;
}

export default function RegionFormDialog({
  open,
  bankId,
  region,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  bankId: string;
  region: Region | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (region: Region) => void;
}) {
  const banksQuery = useBanks();
  const banks = banksQuery.data ?? [];
  const existingBankId = getBankId(region?.bankId, bankId);
  const populatedExistingBank =
    region && typeof region.bankId === "object" ? region.bankId : undefined;
  const existingBank =
    banks.find((bank) => bank._id === existingBankId) ?? populatedExistingBank;
  const createMutation = useCreateRegion();
  const updateMutation = useUpdateRegion(existingBankId);
  const isPending = createMutation.isPending || updateMutation.isPending;
  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<RegionFormSchemaValues>({
    resolver: zodResolver(regionFormSchema),
    defaultValues: {
      bankId: "",
      name: "",
      code: "",
      description: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      bankId: region ? existingBankId : bankId,
      name: region?.name ?? "",
      code: region?.code ?? "",
      description: region?.description ?? "",
      isActive: region?.isActive ?? true,
    });
  }, [bankId, existingBankId, open, region, reset]);
  const selectedBankId = useWatch({ control, name: "bankId" }) ?? "";
  const selectedBank = banks.find(
    (bank) => bank._id === selectedBankId && bank.isActive,
  );

  const onSubmit = async (values: RegionFormSchemaValues) => {
    const { bankId: submittedBankId, ...formValues } = values;
    const data = {
      name: formValues.name.trim(),
      code: formValues.code.trim(),
      description: formValues.description.trim(),
      isActive: formValues.isActive,
    };

    try {
      let savedRegion: Region;
      if (region) {
        savedRegion = await updateMutation.mutateAsync({
          regionId: region._id,
          data,
        });
      } else {
        if (!selectedBank || selectedBank._id !== submittedBankId) {
          setError("bankId", {
            type: "validate",
            message: "Select an active bank.",
          });
          return;
        }
        savedRegion = await createMutation.mutateAsync({
          bankId: selectedBank._id,
          ...data,
        });
      }
      toast.success(
        region
          ? "Region updated successfully."
          : "Region created successfully.",
      );
      reset();
      onOpenChange(false);
      onSaved?.(savedRegion);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const fields = [
    { name: "name", label: "Name", required: true },
    { name: "code", label: "Code", required: false },
    { name: "description", label: "Description", required: false },
  ] as const;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-2">
          <DialogTitle>{region ? "Edit Region" : "Create Region"}</DialogTitle>
          <DialogDescription>
            {region
              ? "Update this region's information."
              : "Choose an active bank for this region."}
          </DialogDescription>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="region-bank"
              className="mb-2 block text-sm font-medium"
            >
              Bank{region ? "" : " *"}
            </label>
            {region ? (
              <div
                id="region-bank"
                className="min-h-9 rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm"
              >
                {existingBank
                  ? `${formatBankLabel(existingBank)}${"isActive" in existingBank && !existingBank.isActive ? " — inactive" : ""}`
                  : existingBankId
                    ? "Bank details unavailable"
                    : "Unmapped"}
              </div>
            ) : (
              <>
                <Select
                  value={selectedBankId || null}
                  onValueChange={(value) => {
                    setValue("bankId", value ?? "", {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    clearErrors("bankId");
                  }}
                  disabled={banksQuery.isLoading || banksQuery.isError}
                >
                  <SelectTrigger
                    id="region-bank"
                    className="w-full"
                    aria-invalid={Boolean(errors.bankId)}
                  >
                    <SelectValue
                      placeholder={
                        banksQuery.isLoading
                          ? "Loading banks..."
                          : "Select an active bank"
                      }
                    >
                      {selectedBank
                        ? formatBankLabel(selectedBank)
                        : "Select an active bank"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map((bank) => (
                      <SelectItem
                        key={bank._id}
                        value={bank._id}
                        disabled={!bank.isActive}
                      >
                        {formatBankLabel(bank)}
                        {!bank.isActive ? " — inactive" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.bankId && (
                  <p className="mt-1 text-sm text-destructive" role="alert">
                    {errors.bankId.message}
                  </p>
                )}
                {!banksQuery.isError &&
                  !banksQuery.isLoading &&
                  !banks.some((bank) => bank.isActive) && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      No active banks are available.
                    </p>
                  )}
                {banksQuery.isError && (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-sm text-destructive">
                      {getErrorMessage(
                        banksQuery.error,
                        "Available banks could not be loaded.",
                      )}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void banksQuery.refetch()}
                      disabled={banksQuery.isFetching}
                    >
                      {banksQuery.isFetching ? "Retrying..." : "Retry"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          {fields.map(({ name, label, required }) => (
            <div key={name}>
              <label
                htmlFor={`region-${name}`}
                className="mb-2 block text-sm font-medium"
              >
                {label}
                {required ? " *" : ""}
              </label>
              {name === "description" ? (
                <textarea
                  id={`region-${name}`}
                  rows={4}
                  {...register(name)}
                  aria-invalid={Boolean(errors[name])}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              ) : (
                <input
                  id={`region-${name}`}
                  type="text"
                  {...register(name)}
                  aria-invalid={Boolean(errors[name])}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              )}
              {errors[name] && (
                <p className="mt-1 text-sm text-destructive">
                  {errors[name]?.message}
                </p>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              id="region-is-active"
              type="checkbox"
              {...register("isActive")}
              className="size-4 accent-primary"
            />
            <label htmlFor="region-is-active" className="text-sm font-medium">
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                (!region && (banksQuery.isLoading || banksQuery.isError))
              }
            >
              {isPending
                ? "Saving..."
                : region
                  ? "Update Region"
                  : "Create Region"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
