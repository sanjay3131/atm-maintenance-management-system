import { useATMs } from "@/features/atms/hooks/useATMs";
import ATMTable from "@/features/atms/components/ATMTable";
import CreateATMForm from "@/features/atms/components/CreateATMForm";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export default function AtmsPage() {
  const { data: atms = [], isLoading, isError } = useATMs();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const queryClient = useQueryClient();

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
        <CreateATMForm onClose={() => setShowCreateForm(false)} />
      )}{" "}
      <div className="mt-6">
        <ATMTable atms={atms} />
      </div>
    </div>
  );
}
