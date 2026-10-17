import type { Bank } from "@/features/banks/types/bank.types";
import { getCustomerBankOptionValue } from "../utils/customerWizard";

interface BankSelectFieldProps {
  id: string;
  value: string;
  banks: Bank[];
  isLoading: boolean;
  isError: boolean;
  onChange: (value: string) => void;
  onRetry: () => void;
}

export default function BankSelectField({
  id,
  value,
  banks,
  isLoading,
  isError,
  onChange,
  onRetry,
}: BankSelectFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        Bank Name
      </label>
      <select
        id={id}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isLoading || isError || banks.length === 0}
        className="w-full rounded-md border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">
          {isLoading
            ? "Loading banks..."
            : isError
              ? "Bank list unavailable"
              : banks.length === 0
                ? "No active banks available"
                : "Select a bank"}
        </option>
        {banks.map((bank) => (
          <option key={bank._id} value={getCustomerBankOptionValue(bank)}>
            {bank.bankName}
          </option>
        ))}
      </select>
      {isError ? (
        <div className="mt-1 flex items-center gap-2 text-xs text-destructive">
          <span>Bank options could not be loaded.</span>
          <button type="button" className="underline" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : banks.length === 0 && !isLoading ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Add an active bank before creating a customer.
        </p>
      ) : null}
    </div>
  );
}
