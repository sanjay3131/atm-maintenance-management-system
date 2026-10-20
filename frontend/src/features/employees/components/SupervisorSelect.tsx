import { useSupervisors } from "@/features/users/hooks/user.hooks";

export default function SupervisorSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const supervisorsQuery = useSupervisors();

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        Supervisor
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={supervisorsQuery.isLoading || supervisorsQuery.isError}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">
          {supervisorsQuery.isLoading ? "Loading supervisors..." : "Unassigned"}
        </option>
        {!supervisorsQuery.isLoading &&
          !supervisorsQuery.isError &&
          supervisorsQuery.data?.length === 0 && (
            <option value="__none_available" disabled>
              No active supervisors available
            </option>
          )}
        {supervisorsQuery.data?.map((supervisor) => (
          <option key={supervisor._id} value={supervisor._id}>
            {[supervisor.firstName, supervisor.lastName]
              .filter(Boolean)
              .join(" ")}{" "}
            ({supervisor.email})
            {supervisor.status !== "active" ? ` - ${supervisor.status}` : ""}
          </option>
        ))}
        {value &&
          !supervisorsQuery.data?.some(
            (supervisor) => supervisor._id === value,
          ) && (
            <option value={value}>
              Current supervisor inactive or unavailable
            </option>
          )}
      </select>
      {supervisorsQuery.isError && (
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-destructive" role="alert">
            Supervisor options could not be loaded.
          </p>
          <button
            type="button"
            onClick={() => void supervisorsQuery.refetch()}
            className="text-xs font-medium underline"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
