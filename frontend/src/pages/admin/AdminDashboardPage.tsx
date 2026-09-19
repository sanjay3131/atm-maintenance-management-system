import { useEffect, useState } from "react";
import { getCurrentUser } from "@/services/auth.service";

export default function AdminDashboardPage() {
  const [message, setMessage] = useState("Testing authentication...");

  useEffect(() => {
    const testAuth = async () => {
      try {
        const data = await getCurrentUser();

        setMessage(`Authenticated as ${data.user.firstName}`);
      } catch {
        setMessage("Authentication request failed");
      }
    };

    testAuth();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      <p className="mt-4">{message}</p>
    </div>
  );
}
