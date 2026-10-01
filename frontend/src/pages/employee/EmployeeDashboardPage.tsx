import { ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

function EmployeeDashboardPage() {
  const navigate = useNavigate();

  return (
    <main className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Employee Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          View the jobs assigned to you.
        </p>
      </div>
      <Button type="button" onClick={() => navigate("/employee/jobs")}>
        <ClipboardList />
        My Jobs
      </Button>
    </main>
  );
}

export default EmployeeDashboardPage;
