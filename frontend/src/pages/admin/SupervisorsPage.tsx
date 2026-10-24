import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { Eye, Pencil, RefreshCw, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useSupervisorManagement,
  useSupervisorManagementDetails,
  useUpdateSupervisor,
  useUpdateSupervisorStatus,
} from "@/features/users/hooks/user.hooks";
import CreateUserWizard from "@/features/users/components/CreateUserWizard";
import type { SupervisorManagementRecord } from "@/features/users/services/user.service";

const PAGE_SIZE = 10;

function getErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "inactive") return "secondary";
  return "outline";
}

function SupervisorEditDialog({
  supervisor,
  onClose,
}: {
  supervisor: SupervisorManagementRecord;
  onClose: () => void;
}) {
  const mutation = useUpdateSupervisor();
  const [firstName, setFirstName] = useState(supervisor.firstName);
  const [lastName, setLastName] = useState(supervisor.lastName ?? "");
  const [email, setEmail] = useState(supervisor.email);
  const [phoneNumber, setPhoneNumber] = useState(supervisor.phoneNumber);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await mutation.mutateAsync({
        id: supervisor._id,
        firstName,
        lastName,
        email,
        phoneNumber,
      });
      toast.success("Supervisor details updated.");
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to update supervisor."));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Edit supervisor</DialogTitle>
        <DialogDescription>
          Update the account details for {supervisor.firstName}.
        </DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              First name
              <input
                required
                minLength={2}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Last name
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3"
              />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3"
              />
            </label>
            <label className="space-y-1 text-sm font-medium sm:col-span-2">
              Phone number
              <input
                required
                type="tel"
                minLength={8}
                maxLength={20}
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SupervisorsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listQuery = useSupervisorManagement({
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
    limit: PAGE_SIZE,
  });
  const detailQuery = useSupervisorManagementDetails(selectedId);
  const editQuery = useSupervisorManagementDetails(editingId);
  const statusMutation = useUpdateSupervisorStatus();
  const supervisors = listQuery.data?.supervisors ?? [];
  const pagination = listQuery.data?.pagination;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const currentPage = Math.min(page, totalPages);
  const firstVisible =
    pagination && pagination.total > 0
      ? (currentPage - 1) * pagination.limit + 1
      : 0;
  const lastVisible = Math.min(
    currentPage * PAGE_SIZE,
    pagination?.total ?? 0,
  );

  const updateStatus = async (supervisor: SupervisorManagementRecord) => {
    const status = supervisor.status === "active" ? "inactive" : "active";
    try {
      await statusMutation.mutateAsync({ id: supervisor._id, status });
      toast.success(
        status === "active" ? "Supervisor activated." : "Supervisor deactivated.",
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to update supervisor status."));
    }
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      {showCreate && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
          <div className="min-h-full py-8">
            <CreateUserWizard
              fixedRole="supervisor"
              onClose={() => setShowCreate(false)}
            />
          </div>
        </div>
      )}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Supervisors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage supervisor accounts and view assigned team sizes.
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreate(true)}>
          <UserPlus aria-hidden="true" />
          Create supervisor
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1 text-sm font-medium">
            Search supervisors
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name, email, or phone"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        {listQuery.isLoading ? (
          <div className="space-y-3 p-5" role="status">
            <div className="h-10 animate-pulse rounded bg-muted/50" />
            <div className="h-52 animate-pulse rounded bg-muted/40" />
            <span className="sr-only">Loading supervisors...</span>
          </div>
        ) : listQuery.isError ? (
          <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p role="alert" className="text-sm text-destructive">
              {getErrorMessage(listQuery.error, "Unable to load supervisors.")}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw
                className={listQuery.isFetching ? "animate-spin" : ""}
                aria-hidden="true"
              />
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">
                  Supervisor accounts and team assignments
                </caption>
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Supervisor</th>
                    <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                    <th scope="col" className="px-4 py-3 font-medium">Team</th>
                    <th scope="col" className="px-4 py-3 font-medium">Account status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {supervisors.map((supervisor) => (
                    <tr key={supervisor._id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">
                          {[supervisor.firstName, supervisor.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {supervisor.email}
                        </p>
                      </td>
                      <td className="px-4 py-3">{supervisor.phoneNumber}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                          {supervisor.teamCount} employees
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(supervisor.status)}>
                          {supervisor.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedId(supervisor._id)}
                            aria-label={`View ${supervisor.firstName}`}
                          >
                            <Eye aria-hidden="true" />
                            View
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(supervisor._id)}
                            aria-label={`Edit ${supervisor.firstName}`}
                          >
                            <Pencil aria-hidden="true" />
                            Edit
                          </Button>
                          {(supervisor.status === "active" ||
                            supervisor.status === "inactive") && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={statusMutation.isPending}
                              onClick={() => void updateStatus(supervisor)}
                            >
                              {supervisor.status === "active"
                                ? "Deactivate"
                                : "Activate"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {supervisors.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {search.trim()
                  ? "No supervisors match your search."
                  : "No supervisors have been created."}
              </p>
            ) : (
              <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Showing {firstVisible}–{lastVisible} of {pagination?.total ?? 0} supervisors
                </p>
                <nav aria-label="Supervisor pagination" className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1 || listQuery.isFetching}
                  >
                    Previous
                  </Button>
                  <span className="px-2 text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage >= totalPages || listQuery.isFetching}
                  >
                    Next
                  </Button>
                </nav>
              </div>
            )}
          </>
        )}
      </Card>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent>
          <DialogTitle>Supervisor details</DialogTitle>
          {detailQuery.isLoading ? (
            <p role="status" className="py-5 text-sm text-muted-foreground">
              Loading supervisor details...
            </p>
          ) : detailQuery.isError ? (
            <div className="space-y-3 py-4">
              <p role="alert" className="text-sm text-destructive">
                {getErrorMessage(detailQuery.error, "Unable to load details.")}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void detailQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : detailQuery.data ? (
            <>
              <DialogDescription>
                Account and current team information.
              </DialogDescription>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Name</dt>
                  <dd className="font-medium">
                    {[detailQuery.data.firstName, detailQuery.data.lastName]
                      .filter(Boolean)
                      .join(" ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd><Badge variant={statusVariant(detailQuery.data.status)}>{detailQuery.data.status}</Badge></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Email</dt>
                  <dd className="break-all">{detailQuery.data.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Phone</dt>
                  <dd>{detailQuery.data.phoneNumber}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Assigned employees</dt>
                  <dd>{detailQuery.data.teamCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Account created</dt>
                  <dd>{new Date(detailQuery.data.createdAt).toLocaleDateString()}</dd>
                </div>
              </dl>
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingId(detailQuery.data._id);
                    setSelectedId(null);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Edit details
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {editingId && editQuery.data && (
        <SupervisorEditDialog
          key={editingId}
          supervisor={editQuery.data}
          onClose={() => setEditingId(null)}
        />
      )}
      {editingId && editQuery.isLoading && (
        <Dialog open>
          <DialogContent>
            <DialogTitle>Loading supervisor</DialogTitle>
            <p role="status" className="text-sm text-muted-foreground">
              Loading supervisor details...
            </p>
          </DialogContent>
        </Dialog>
      )}
      {editingId && editQuery.isError && (
        <Dialog open onOpenChange={(open) => !open && setEditingId(null)}>
          <DialogContent>
            <DialogTitle>Unable to edit supervisor</DialogTitle>
            <p role="alert" className="py-3 text-sm text-destructive">
              {getErrorMessage(editQuery.error, "Unable to load supervisor.")}
            </p>
            <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
              Close
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
