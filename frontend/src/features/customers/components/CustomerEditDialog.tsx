import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Bank } from "@/features/banks/types/bank.types";
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
      <DialogContent>
        <div className="space-y-2">
          <DialogTitle>Edit customer</DialogTitle>
          <DialogDescription>
            Update the customer profile information. ATM assignments are
            managed separately.
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
      className="mt-5 space-y-4"
      onSubmit={(event) => void handleSubmit(event)}
    >
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

      <div className="flex justify-end gap-2 pt-2">
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
