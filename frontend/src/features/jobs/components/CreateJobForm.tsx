import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useATMs } from "@/features/atms/hooks/useATMs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateJob } from "../hooks/useCreateJob";
import {
  createJobFormSchema,
  type CreateJobFormValues,
} from "../types/create-job.schema";
import type {
  CreateJobData,
  JobPriority,
  JobWorkType,
} from "../types/job.types";

interface CreateJobFormProps {
  onCancel: () => void;
  onCreated: () => void;
  initialAtmId?: string;
  initialComplaintId?: string;
  initialTitle?: string;
  initialDescription?: string;
}

interface ComplaintOption {
  _id: string;
  complaintNumber: string;
  title: string;
  status: string;
  jobId?: string | { _id: string } | null;
}

const workTypes: JobWorkType[] = [
  "repair",
  "maintenance",
  "installation",
  "inspection",
  "emergency",
];

const priorities: JobPriority[] = ["low", "medium", "high", "critical"];

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to create the job.";
  }

  return error instanceof Error ? error.message : "Unable to create the job.";
}

export default function CreateJobForm({
  onCancel,
  onCreated,
  initialAtmId,
  initialComplaintId,
  initialTitle,
  initialDescription,
}: CreateJobFormProps) {
  const {
    data: atms = [],
    isLoading: isAtmsLoading,
    isError: isAtmsError,
    refetch: refetchATMs,
    isFetching: isFetchingATMs,
  } = useATMs();
  const createJobMutation = useCreateJob();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateJobFormValues>({
    resolver: zodResolver(createJobFormSchema),
    defaultValues: {
      title: initialTitle ?? "",
      description: initialDescription ?? "",
      atmId: "",
      complaintId: "",
      workType: "repair",
      priority: "medium",
    },
  });

  const [atmPrefillStatus, setAtmPrefillStatus] = useState<
    "pending" | "applied" | "unavailable"
  >(initialAtmId ? "pending" : "unavailable");
  const [complaintPrefillStatus, setComplaintPrefillStatus] = useState<
    "pending" | "applied" | "unavailable"
  >(initialComplaintId ? "pending" : "unavailable");
  const selectedATMId = watch("atmId");
  const selectedComplaintId = watch("complaintId");
  const selectedATM = atms.find((atm) => atm._id === selectedATMId);
  const {
    data: complaints = [],
    isLoading: areComplaintsLoading,
    isError: areComplaintsError,
    refetch: refetchComplaints,
    isFetching: areComplaintsFetching,
  } = useQuery({
    queryKey: ["job-create-complaints", selectedATMId],
    enabled: Boolean(selectedATMId),
    queryFn: async () => {
      const response = await api.get<{
        data: { complaints: ComplaintOption[] };
      }>(`/complaints/atm/${selectedATMId}`, {
        params: { page: 1, limit: 50 },
      });

      return response.data.data.complaints.filter(
        (complaint) =>
          !complaint.jobId &&
          complaint.status !== "CLOSED" &&
          complaint.status !== "CANCELLED",
      );
    },
  });
  const selectedComplaint = complaints.find(
    (complaint) => complaint._id === selectedComplaintId,
  );

  useEffect(() => {
    if (
      !initialAtmId ||
      isAtmsLoading ||
      isAtmsError ||
      selectedATMId
    ) {
      return;
    }

    const matchingATM = atms.find((atm) => atm._id === initialAtmId);
    if (!matchingATM) {
      setAtmPrefillStatus("unavailable");
      return;
    }

    setValue("atmId", matchingATM._id, { shouldValidate: true });
    setAtmPrefillStatus("applied");
  }, [
    atms,
    initialAtmId,
    isAtmsError,
    isAtmsLoading,
    selectedATMId,
    setValue,
  ]);

  useEffect(() => {
    if (!initialComplaintId || selectedComplaintId) return;

    if (!selectedATMId || selectedATMId !== initialAtmId) {
      if (atmPrefillStatus === "unavailable") {
        setComplaintPrefillStatus("unavailable");
      }
      return;
    }

    if (areComplaintsLoading || areComplaintsError) return;

    const matchingComplaint = complaints.find(
      (complaint) => complaint._id === initialComplaintId,
    );
    if (!matchingComplaint) {
      setComplaintPrefillStatus("unavailable");
      return;
    }

    setValue("complaintId", matchingComplaint._id, {
      shouldValidate: true,
    });
    setComplaintPrefillStatus("applied");
  }, [
    areComplaintsError,
    areComplaintsLoading,
    atmPrefillStatus,
    complaints,
    initialAtmId,
    initialComplaintId,
    selectedATMId,
    selectedComplaintId,
    setValue,
  ]);

  const onSubmit = (values: CreateJobFormValues) => {
    const matchingATM = atms.find((atm) => atm._id === values.atmId);
    if (!matchingATM) {
      toast.error("Select an available ATM before creating the Job.");
      return;
    }

    const matchingComplaint = values.complaintId
      ? complaints.find((complaint) => complaint._id === values.complaintId)
      : undefined;
    if (values.complaintId && !matchingComplaint) {
      toast.error(
        "The selected Complaint is no longer available. Select an available Complaint or clear the selection.",
      );
      return;
    }

    const payload: CreateJobData = {
      title: values.title,
      atmId: matchingATM._id,
      ...(values.description ? { description: values.description } : {}),
      ...(matchingComplaint ? { complaintId: matchingComplaint._id } : {}),
      ...(values.workType ? { workType: values.workType } : {}),
      ...(values.priority ? { priority: values.priority } : {}),
    };

    createJobMutation.mutate(payload, {
      onSuccess: (job) => {
        toast.success(
          `Job ${job.jobNumber || job.jobId} created successfully.`,
        );
        onCreated();
      },
      onError: (error) => {
        toast.error(getErrorMessage(error));
      },
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
      <div>
        <label htmlFor="job-title" className="mb-2 block text-sm font-medium">
          Title
        </label>
        <input
          id="job-title"
          {...register("title")}
          maxLength={200}
          aria-invalid={Boolean(errors.title)}
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
          htmlFor="job-description"
          className="mb-2 block text-sm font-medium"
        >
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="job-description"
          {...register("description")}
          rows={3}
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
          onValueChange={(value) => {
            setValue("atmId", value ?? "", {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            });
            setValue("complaintId", "", { shouldDirty: true });
          }}
          disabled={isAtmsLoading || isAtmsError || atms.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                isAtmsLoading
                  ? "Loading ATMs..."
                  : atms.length === 0
                    ? "No ATMs available"
                    : "Select an ATM"
              }
            >
              {selectedATM
                ? `${selectedATM.atmId} · ${selectedATM.locationName}`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {atms.map((atm) => (
              <SelectItem key={atm._id} value={atm._id}>
                <span className="font-medium">{atm.atmId}</span>
                <span className="text-muted-foreground">
                  {atm.locationName}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.atmId && (
          <p className="mt-1 text-sm text-destructive">
            {errors.atmId.message}
          </p>
        )}
        {isAtmsError && (
          <div className="mt-2 flex items-center justify-between gap-3 text-sm text-destructive">
            <span>Could not load ATMs.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetchATMs()}
              disabled={isFetchingATMs}
            >
              {isFetchingATMs ? "Retrying..." : "Retry"}
            </Button>
          </div>
        )}
        {initialAtmId &&
          atmPrefillStatus === "unavailable" &&
          !selectedATMId && (
            <p className="mt-2 text-sm text-amber-700" role="status">
              The requested ATM is unavailable. Select an ATM manually.
            </p>
          )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">
          Complaint{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Select
          value={selectedComplaintId || null}
          onValueChange={(value) =>
            setValue("complaintId", value ?? "", {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            })
          }
          disabled={
            !selectedATMId ||
            areComplaintsLoading ||
            areComplaintsError ||
            complaints.length === 0
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                !selectedATMId
                  ? "Select an ATM first"
                  : areComplaintsLoading
                    ? "Loading complaints..."
                    : complaints.length === 0
                      ? "No available complaints"
                      : "Select a complaint"
              }
            >
              {selectedComplaint
                ? `${selectedComplaint.complaintNumber} · ${selectedComplaint.title}`
                : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {complaints.map((complaint) => (
              <SelectItem key={complaint._id} value={complaint._id}>
                <span className="font-medium">{complaint.complaintNumber}</span>
                <span className="text-muted-foreground">{complaint.title}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.complaintId && (
          <p className="mt-1 text-sm text-destructive">
            {errors.complaintId.message}
          </p>
        )}
        {areComplaintsError && selectedATMId && (
          <div className="mt-2 flex items-center justify-between gap-3 text-sm text-destructive">
            <span>
              Could not load complaints. You can still create without one.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetchComplaints()}
              disabled={areComplaintsFetching}
            >
              {areComplaintsFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        )}
        {initialComplaintId &&
          complaintPrefillStatus === "unavailable" &&
          !selectedComplaintId && (
            <p className="mt-2 text-sm text-amber-700" role="status">
              The requested Complaint is unavailable for this ATM. Select a
              Complaint manually or continue without one.
            </p>
          )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium">Work type</label>
          <Select
            value={watch("workType") ?? null}
            onValueChange={(value) =>
              setValue("workType", (value as JobWorkType | null) ?? undefined, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select work type" />
            </SelectTrigger>
            <SelectContent>
              {workTypes.map((workType) => (
                <SelectItem key={workType} value={workType}>
                  {workType.charAt(0).toUpperCase() + workType.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.workType && (
            <p className="mt-1 text-sm text-destructive">
              {errors.workType.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Priority</label>
          <Select
            value={watch("priority") ?? null}
            onValueChange={(value) =>
              setValue("priority", (value as JobPriority | null) ?? undefined, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select priority" />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
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
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={createJobMutation.isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            createJobMutation.isPending ||
            isAtmsLoading ||
            isAtmsError ||
            atms.length === 0
          }
        >
          {createJobMutation.isPending ? "Creating..." : "Create job"}
        </Button>
      </div>
    </form>
  );
}
