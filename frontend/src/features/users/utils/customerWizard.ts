import type { Bank } from "@/features/banks/types/bank.types";
import type {
  CustomerDetailsForm,
  UserDetailsForm,
} from "../types/user.types";

export type CustomerIdentityField =
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "bankName";

export type CustomerEditedFields = Partial<
  Record<CustomerIdentityField, boolean>
>;

export const getCustomerWizardSteps = (customerOnly: boolean) =>
  customerOnly ? [1, 2] : [1, 2, 3];

export const getCustomerBankOptionValue = (bank: Bank) => bank.bankName;

export const createCustomerWizardPayload = (
  user: UserDetailsForm,
  customer: CustomerDetailsForm,
): { user: UserDetailsForm; customer: CustomerDetailsForm } => ({
  user,
  customer,
});

export const prefillCustomerDetails = (
  user: UserDetailsForm,
  current: CustomerDetailsForm,
  edited: CustomerEditedFields,
): CustomerDetailsForm => ({
  ...current,
  customerName: edited.customerName
    ? current.customerName
    : [user.firstName, user.lastName].filter(Boolean).join(" "),
  customerEmail: edited.customerEmail ? current.customerEmail : user.email,
  customerPhone: edited.customerPhone
    ? current.customerPhone
    : user.phoneNumber,
});
