import { useATMs } from "@/features/atms/hooks/useATMs";
import ATMTable from "@/features/atms/components/ATMTable";
import CreateATMForm from "@/features/atms/components/CreateATMForm";
import { useState } from "react";
export default function AtmsPage() {
  const { data: atms = [], isLoading, isError } = useATMs();
  const [showCreateForm, setShowCreateForm] = useState(false);

  if (isLoading) {
    return <div className="p-6">Loading ATMs...</div>;
  }

  if (isError) {
    return <div className="p-6 text-red-500">Failed to load ATMs.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">ATM Management</h1>
      <p className="mt-2 text-gray-500">Total ATMs: {atms.length}</p>
      <button
        type="button"
        onClick={() => setShowCreateForm(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Create ATM
      </button>
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-background p-6 shadow-xl scrollbar-width:none [&::-webkit-scrollbar]:hidden">
            {" "}
            <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 flex items-center justify-between border-b bg-background px-6 py-4">
              {" "}
              <h2 className="text-xl font-semibold">Create ATM</h2>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <CreateATMForm onClose={() => setShowCreateForm(false)} />
          </div>
        </div>
      )}
      <div className="mt-6">
        <ATMTable atms={atms} />
      </div>
    </div>
  );
}
