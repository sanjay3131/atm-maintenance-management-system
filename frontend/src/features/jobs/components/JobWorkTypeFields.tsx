import {
  AC_SUB_TYPES,
  JOB_WORK_TYPES,
  type AcSubType,
  type JobWorkType,
  type SelectableJobWorkType,
} from "../types/job.types";
import {
  formatAcSubType,
  formatJobWorkType,
  isAcWorkType,
} from "../utils/jobWorkType.utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface JobWorkTypeFieldsProps {
  workType?: JobWorkType;
  acSubType?: AcSubType;
  workTypeError?: string;
  acSubTypeError?: string;
  onWorkTypeChange: (value: SelectableJobWorkType | undefined) => void;
  onAcSubTypeChange: (value: AcSubType | undefined) => void;
}

export default function JobWorkTypeFields({
  workType,
  acSubType,
  workTypeError,
  acSubTypeError,
  onWorkTypeChange,
  onAcSubTypeChange,
}: JobWorkTypeFieldsProps) {
  return (
    <>
      <div>
        <label className="mb-2 block text-sm font-medium">Work type</label>
        <Select
          value={workType ?? null}
          onValueChange={(value) =>
            onWorkTypeChange(
              (value as SelectableJobWorkType | null) ?? undefined,
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select work type" />
          </SelectTrigger>
          <SelectContent>
            {[
              ...(workType && !JOB_WORK_TYPES.includes(
                workType as SelectableJobWorkType,
              )
                ? [workType]
                : []),
              ...JOB_WORK_TYPES,
            ].map((option) => (
              <SelectItem
                key={option}
                value={option}
                disabled={
                  option === "inspection" || option === "emergency"
                }
              >
                {formatJobWorkType(option)}
                {option === "inspection" || option === "emergency"
                  ? " (legacy)"
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {workTypeError && (
          <p className="mt-1 text-sm text-destructive">{workTypeError}</p>
        )}
      </div>
      {isAcWorkType(workType) && (
        <div>
          <label className="mb-2 block text-sm font-medium">AC sub-type</label>
          <Select
            value={acSubType ?? null}
            onValueChange={(value) =>
              onAcSubTypeChange((value as AcSubType | null) ?? undefined)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select AC sub-type" />
            </SelectTrigger>
            <SelectContent>
              {AC_SUB_TYPES.map((option) => (
                <SelectItem key={option} value={option}>
                  {formatAcSubType(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {acSubTypeError && (
            <p className="mt-1 text-sm text-destructive">{acSubTypeError}</p>
          )}
        </div>
      )}
    </>
  );
}
