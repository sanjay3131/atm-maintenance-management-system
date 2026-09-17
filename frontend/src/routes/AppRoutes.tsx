import { Navigate, Route, Routes } from "react-router-dom";

import LoginPage from "@/pages/auth/LoginPage";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import EmployeeDashboardPage from "@/pages/employee/EmployeeDashboardPage";
import SupervisorDashboardPage from "@/pages/supervisor/SupervisorDashboardPage";

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Admin */}
      <Route path="/admin" element={<AdminDashboardPage />} />

      {/* Supervisor */}
      <Route path="/supervisor" element={<SupervisorDashboardPage />} />

      {/* Employee */}
      <Route path="/employee" element={<EmployeeDashboardPage />} />

      {/* Fallback */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default AppRoutes;
