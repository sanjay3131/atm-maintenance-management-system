import { useEffect } from "react";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCreateBank, useUpdateBank } from "../hooks/useBankMutations";
import { bankFormSchema } from "../types/bank.schema";
import type {
  Bank,
  BankFormValues,
  CreateBankData,
} from "../types/bank.types";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to save the bank.";
  }
  return error instanceof Error ? error.message : "Unable to save the bank.";
}

function optionalValue(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export default function BankFormDialog({
  open,
  bank,
  onOpenChange,
}: {
  open: boolean;
  bank: Bank | null;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateBank();
  const updateMutation = useUpdateBank();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BankFormValues>({
    resolver: zodResolver(bankFormSchema),
    defaultValues: {
      bankName: "",
      bankCode: "",
      contactEmail: "",
      contactPhone: "",
      address: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      bankName: bank?.bankName ?? "",
      bankCode: bank?.bankCode ?? "",
      contactEmail: bank?.contactEmail ?? "",
      contactPhone: bank?.contactPhone ?? "",
      address: bank?.address ?? "",
    });
  }, [bank, open, reset]);

  const onSubmit = async (values: BankFormValues) => {
    const data: CreateBankData = {
      bankName: values.bankName.trim(),
      bankCode: values.bankCode.trim().toUpperCase(),
      contactEmail: optionalValue(values.contactEmail),
      contactPhone: optionalValue(values.contactPhone),
      address: optionalValue(values.address),
    };

    try {
      if (bank) {
        await updateMutation.mutateAsync({ id: bank._id, data });
        toast.success("Bank updated successfully.");
      } else {
        await createMutation.mutateAsync(data);
        toast.success("Bank created successfully.");
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const fields = [
    { name: "bankName", label: "Bank Name", required: true },
    { name: "bankCode", label: "Bank Code", required: true },
    { name: "contactEmail", label: "Contact Email", required: false },
    { name: "contactPhone", label: "Contact Phone", required: false },
    { name: "address", label: "Address", required: false },
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
          <DialogTitle>{bank ? "Edit Bank" : "Add Bank"}</DialogTitle>
          <DialogDescription>
            {bank
              ? "Update this bank's master information."
              : "Add a bank to the ATM maintenance system."}
          </DialogDescription>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          {fields.map(({ name, label, required = false }) => (
            <div key={name}>
              <label
                htmlFor={`bank-${name}`}
                className="mb-2 block text-sm font-medium"
              >
                {label}
                {required ? " *" : ""}
              </label>
              {name === "address" ? (
                <textarea
                  id={`bank-${name}`}
                  {...register(name)}
                  aria-invalid={Boolean(errors[name])}
                  rows={3}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              ) : (
                <input
                  id={`bank-${name}`}
                  type={name === "contactEmail" ? "email" : "text"}
                  autoComplete={name === "contactEmail" ? "email" : undefined}
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
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : bank
                  ? "Update Bank"
                  : "Create Bank"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
