import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useATMs } from "@/features/atms/hooks/useATMs";
import type { ATM } from "@/features/atms/types/atm.types";
import { useCustomers } from "@/features/customers/hooks/useCustomers";
import type { Customer } from "@/features/customers/services/customer.service";
import { useCreateComplaint } from "../hooks/useCreateComplaint";
import {
  createComplaintSchema,
  type CreateComplaintFormValues,
} from "../types/create-complaint.schema";
import type {
  ComplaintPriority,
  CreateComplaintData,
} from "../types/complaint.types";

const PRIORITIES: ComplaintPriority[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];
const REPORTED_VIA = [
  "phone",
  "email",
  "whatsapp",
  "in_person",
  "other",
] as const;
const NO_CUSTOMER = "NO_CUSTOMER";

const EMPTY_VALUES: CreateComplaintFormValues = {
  title: "",
  description: "",
  atmId: "",
  customerId: "",
  reportedBy: "",
  reportedVia: "phone",
  priority: "MEDIUM",
};

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to create the complaint.";
  }
  return error instanceof Error
    ? error.message
    : "Unable to create the complaint.";
}

function getCustomerId(atm?: ATM) {
  if (!atm?.customer) return undefined;
  return typeof atm.customer === "string" ? atm.customer : atm.customer._id;
}

function getCustomerLabel(customer: Customer) {
  const name = customer.customerName.trim();
  const email = customer.customerEmail.trim();
  if (name && email) return `${name} · ${email}`;
  return name || email || "Customer details unavailable";
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function CreateComplaintDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const {
    data: atms = [],
    isLoading: isLoadingATMs,
    isError: isATMsError,
  } = useATMs();
  const {
    data: customers = [],
    isLoading: isLoadingCustomers,
    isError: isCustomersError,
  } = useCustomers();
  const createMutation = useCreateComplaint();
  const [submitError, setSubmitError] = useState("");
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<CreateComplaintFormValues>({
    resolver: zodResolver(createComplaintSchema),
    defaultValues: EMPTY_VALUES,
  });
  const selectedATMId = watch("atmId");
  const selectedCustomerId = watch("customerId");
  const selectedATM = atms.find((atm) => atm._id === selectedATMId);
  const associatedCustomerId = getCustomerId(selectedATM);
  const associatedCustomer = customers.find(
    (customer) => customer._id === associatedCustomerId,
  );
  const customerOptions = useMemo(
    () =>
      associatedCustomerId
        ? customers.filter((customer) => customer._id === associatedCustomerId)
        : customers,
    [associatedCustomerId, customers],
  );
  const selectedCustomer = customerOptions.find(
    (customer) => customer._id === selectedCustomerId,
  );

  useEffect(() => {
    if (open) {
      reset(EMPTY_VALUES);
      setSubmitError("");
    }
  }, [open, reset]);

  useEffect(() => {
    if (!selectedATMId || isLoadingCustomers || isCustomersError) return;

    const atm = atms.find((option) => option._id === selectedATMId);
    const linkedCustomerId = getCustomerId(atm);
    if (!linkedCustomerId) return;

    const matchingCustomer = customers.find(
      (customer) => customer._id === linkedCustomerId,
    );
    setValue("customerId", matchingCustomer?._id ?? "", {
      shouldValidate: true,
    });
  }, [
    atms,
    customers,
    isCustomersError,
    isLoadingCustomers,
    selectedATMId,
    setValue,
  ]);

  const handleATMChange = (value: string | null) => {
    const atmId = value ?? "";
    const atm = atms.find((option) => option._id === atmId);
    const linkedCustomerId = getCustomerId(atm);
    const matchedCustomer = customers.find(
      (customer) => customer._id === linkedCustomerId,
    );

    setValue("atmId", atmId, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue("customerId", matchedCustomer?._id ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const onSubmit = async (values: CreateComplaintFormValues) => {
    const atm = atms.find((option) => option._id === values.atmId);
    if (!atm) {
      setSubmitError(
        "The selected ATM is unavailable. Choose an available ATM.",
      );
      return;
    }

    const customer = values.customerId
      ? customerOptions.find((option) => option._id === values.customerId)
      : undefined;
    if (values.customerId && !customer) {
      setSubmitError(
        "The selected Customer is unavailable for this ATM. Choose a valid Customer or clear the selection.",
      );
      return;
    }

    const linkedCustomerId = getCustomerId(atm);
    if (linkedCustomerId && customer && customer._id !== linkedCustomerId) {
      setSubmitError(
        "The Customer must match the selected ATM.",
      );
      return;
    }

    const payload: CreateComplaintData = {
      title: values.title,
      description: values.description,
      atmId: atm._id,
      ...(customer ? { customerId: customer._id } : {}),
      reportedBy: values.reportedBy,
      reportedVia: values.reportedVia,
      priority: values.priority,
    };

    setSubmitError("");
    try {
      const complaint = await createMutation.mutateAsync(payload);
      toast.success(
        `Complaint ${complaint.complaintNumber || "created"} successfully.`,
      );
      reset(EMPTY_VALUES);
      setSubmitError("");
      onOpenChange(false);
      onCreated();
    } catch (error) {
      const message = getErrorMessage(error);
      setSubmitError(message);
      toast.error(message);
    }
  };

  const isPending = createMutation.isPending;
  const atmItems = atms.map((atm) => ({
    value: atm._id,
    label: [atm.atmId, atm.locationName].filter(Boolean).join(" · "),
  }));
  const customerItems = [
    { value: NO_CUSTOMER, label: "No customer" },
    ...customerOptions.map((customer) => ({
      value: customer._id,
      label: getCustomerLabel(customer),
    })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <div className="space-y-2">
          <DialogTitle>Create Complaint</DialogTitle>
          <DialogDescription>
            Record an ATM complaint. Job creation and linking are handled
            separately.
          </DialogDescription>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-5 space-y-4"
          noValidate
        >
          <div>
            <label
              htmlFor="complaint-create-title"
              className="mb-2 block text-sm font-medium"
            >
              Title
            </label>
            <input
              id="complaint-create-title"
              {...register("title")}
              maxLength={200}
              aria-invalid={Boolean(errors.title)}
              disabled={isPending}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {errors.title && (
              <p className="mt-1 text-sm text-destructive">
                {errors.title.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="complaint-create-description"
              className="mb-2 block text-sm font-medium"
            >
              Description
            </label>
            <textarea
              id="complaint-create-description"
              {...register("description")}
              maxLength={2000}
              rows={4}
              aria-invalid={Boolean(errors.description)}
              disabled={isPending}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {errors.description && (
              <p className="mt-1 text-sm text-destructive">
                {errors.description.message}
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">ATM</label>
            <Select
              value={selectedATMId || null}
              items={atmItems}
              onValueChange={handleATMChange}
              disabled={isPending || isLoadingATMs || isATMsError}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isLoadingATMs
                      ? "Loading ATMs..."
                      : isATMsError
                        ? "ATM list unavailable"
                        : "Select an ATM"
                  }
                >
                  {selectedATM
                    ? [selectedATM.atmId, selectedATM.locationName]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {atms.map((atm) => (
                  <SelectItem key={atm._id} value={atm._id}>
                    <span className="font-medium">{atm.atmId}</span>
                    {atm.locationName && (
                      <span className="text-muted-foreground">
                        {atm.locationName}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.atmId && (
              <p className="mt-1 text-sm text-destructive">
                {errors.atmId.message}
              </p>
            )}
            {isATMsError && (
              <p className="mt-1 text-sm text-destructive">
                ATM options could not be loaded. Try again later.
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Customer</label>
            <Select
              value={selectedCustomerId || null}
              items={customerItems}
              onValueChange={(value) =>
                setValue(
                  "customerId",
                  value === NO_CUSTOMER ? "" : (value ?? ""),
                  {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  },
                )
              }
              disabled={
                isPending ||
                !selectedATMId ||
                isLoadingCustomers ||
                isCustomersError ||
                Boolean(associatedCustomerId)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !selectedATMId
                      ? "Select an ATM first"
                      : isLoadingCustomers
                        ? "Loading customers..."
                        : isCustomersError
                          ? "Customer list unavailable"
                          : "No customer"
                  }
                >
                  {selectedCustomer
                    ? getCustomerLabel(selectedCustomer)
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CUSTOMER}>No customer</SelectItem>
                {customerOptions.map((customer) => (
                  <SelectItem key={customer._id} value={customer._id}>
                    {getCustomerLabel(customer)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {associatedCustomerId &&
              !associatedCustomer &&
              !isLoadingCustomers && (
                <p className="mt-1 text-sm text-amber-700" role="status">
                  This ATM has an associated Customer that is not available in
                  the current Customer list.
                </p>
              )}
            {isCustomersError && (
              <p className="mt-1 text-sm text-destructive">
                Customer options could not be loaded.
              </p>
            )}
            {errors.customerId && (
              <p className="mt-1 text-sm text-destructive">
                {errors.customerId.message}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="complaint-create-reported-by"
                className="mb-2 block text-sm font-medium"
              >
                Reported by
              </label>
              <input
                id="complaint-create-reported-by"
                {...register("reportedBy")}
                maxLength={100}
                aria-invalid={Boolean(errors.reportedBy)}
                disabled={isPending}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              {errors.reportedBy && (
                <p className="mt-1 text-sm text-destructive">
                  {errors.reportedBy.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Reported via
              </label>
              <Select
                value={watch("reportedVia")}
                items={REPORTED_VIA.map((value) => ({
                  value,
                  label: formatLabel(value),
                }))}
                onValueChange={(value) =>
                  setValue(
                    "reportedVia",
                    (value as CreateComplaintFormValues["reportedVia"]) ??
                      "phone",
                    { shouldDirty: true, shouldValidate: true },
                  )
                }
                disabled={isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORTED_VIA.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.reportedVia && (
                <p className="mt-1 text-sm text-destructive">
                  {errors.reportedVia.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Priority</label>
            <Select
              value={watch("priority")}
              items={PRIORITIES.map((value) => ({
                value,
                label: formatLabel(value),
              }))}
              onValueChange={(value) =>
                setValue(
                  "priority",
                  (value as ComplaintPriority | null) ?? "MEDIUM",
                  { shouldDirty: true, shouldValidate: true },
                )
              }
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {formatLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.priority && (
              <p className="mt-1 text-sm text-destructive">
                {errors.priority.message}
              </p>
            )}
          </div>

          {submitError && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {submitError}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || isLoadingATMs || isATMsError}
            >
              {isPending ? "Creating..." : "Create Complaint"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
