import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import LoginPage from "@/pages/auth/LoginPage";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import SupervisorDashboardPage from "@/pages/supervisor/SupervisorDashboardPage";
import EmployeeDashboardPage from "@/pages/employee/EmployeeDashboardPage";
import ProtectedRoute from "@/routes/ProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={<ProtectedRoute allowedRoles={["admin", "superAdmin"]} />}
        >
          <Route path="/admin" element={<AdminDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["supervisor"]} />}>
          <Route path="/supervisor" element={<SupervisorDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["employee"]} />}>
          <Route path="/employee" element={<EmployeeDashboardPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
