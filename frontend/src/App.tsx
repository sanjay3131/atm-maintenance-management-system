import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import LoginPage from "@/pages/auth/LoginPage";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import SupervisorDashboardPage from "@/pages/supervisor/SupervisorDashboardPage";
import EmployeeDashboardPage from "@/pages/employee/EmployeeDashboardPage";
import ProtectedRoute from "@/routes/ProtectedRoute";
import AdminLayout from "@/layouts/AdminLayout";
import EmployeesPage from "@/pages/admin/EmployeesPage";
import AtmsPage from "@/pages/admin/AtmsPage";
import JobsPage from "@/pages/admin/JobsPage";
import AmcPage from "@/pages/admin/AmcPage";
import ComplaintsPage from "@/pages/admin/ComplaintsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={<ProtectedRoute allowedRoles={["admin", "superAdmin"]} />}
        >
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/employees" element={<EmployeesPage />} />
            <Route path="/admin/atms" element={<AtmsPage />} />
            <Route path="/admin/jobs" element={<JobsPage />} />
            <Route path="/admin/amc" element={<AmcPage />} />
            <Route path="/admin/complaints" element={<ComplaintsPage />} />
          </Route>
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
