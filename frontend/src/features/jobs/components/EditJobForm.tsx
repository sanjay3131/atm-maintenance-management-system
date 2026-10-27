import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateJob } from "../hooks/useUpdateJob";
import {
  updateJobFormSchema,
  type UpdateJobFormValues,
} from "../types/create-job.schema";
import type { Job, JobPriority } from "../types/job.types";
import { getAcSubTypeAfterWorkTypeChange } from "../utils/jobWorkType.utils";
import JobWorkTypeFields from "./JobWorkTypeFields";

const priorities: JobPriority[] = ["low", "medium", "high", "critical"];

interface EditJobFormProps {
  job: Job;
  onCancel: () => void;
  onUpdated: () => void;
}

export default function EditJobForm({
  job,
  onCancel,
  onUpdated,
}: EditJobFormProps) {
  const updateJobMutation = useUpdateJob();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UpdateJobFormValues>({
    resolver: zodResolver(updateJobFormSchema),
    defaultValues: {
      title: job.title,
      description: job.description ?? "",
      workType: job.workType,
      acSubType: job.acSubType,
      priority: job.priority,
    },
  });
  const selectedWorkType = watch("workType");
  const selectedAcSubType = watch("acSubType");
  const selectedPriority = watch("priority");

  const onSubmit = (values: UpdateJobFormValues) => {
    updateJobMutation.mutate(
      { jobId: job._id, data: values },
      {
        onSuccess: () => {
          toast.success("Job updated successfully.");
          onUpdated();
        },
        onError: (error) => {
          const message = isAxiosError<{ message?: string }>(error)
            ? error.response?.data?.message || "Unable to update the job."
            : error instanceof Error
              ? error.message
              : "Unable to update the job.";
          toast.error(message);
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label htmlFor="edit-job-title" className="mb-2 block text-sm font-medium">
          Title
        </label>
        <input
          id="edit-job-title"
          {...register("title")}
          maxLength={200}
          aria-invalid={Boolean(errors.title)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {errors.title && (
          <p className="mt-1 text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>
      <div>
        <label htmlFor="edit-job-description" className="mb-2 block text-sm font-medium">
          Description
        </label>
        <textarea
          id="edit-job-description"
          {...register("description")}
          rows={3}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-4">
          <JobWorkTypeFields
            workType={selectedWorkType}
            acSubType={selectedAcSubType}
            workTypeError={errors.workType?.message}
            acSubTypeError={errors.acSubType?.message}
            onWorkTypeChange={(value) => {
              if (!value) return;
              setValue("workType", value, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue(
                "acSubType",
                getAcSubTypeAfterWorkTypeChange(value, selectedAcSubType),
                { shouldDirty: true, shouldValidate: true },
              );
            }}
            onAcSubTypeChange={(value) =>
              setValue("acSubType", value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">Priority</label>
          <Select
            value={selectedPriority}
            onValueChange={(value) =>
              setValue("priority", value as JobPriority, {
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
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={updateJobMutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={updateJobMutation.isPending}>
          {updateJobMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
