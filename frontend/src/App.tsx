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
import ComplaintDetailsPage from "@/pages/admin/ComplaintDetailsPage";
import ATMDetailsPage from "@/pages/admin/ATMDetailsPage";
import EditATMPage from "@/pages/admin/EditATMPage";
import JobDetailsPage from "@/pages/admin/JobDetailsPage";
import RecurringMaintenancePage from "@/pages/admin/RecurringMaintenancePage";
import EmployeeJobsPage from "@/pages/employee/EmployeeJobsPage";
import BanksPage from "@/pages/admin/BanksPage";
import BankDetailPage from "@/pages/admin/BankDetailPage";
import DistrictsPage from "@/pages/admin/DistrictsPage";
import DistrictDetailPage from "@/pages/admin/DistrictDetailPage";
import RegionDetailPage from "@/pages/admin/RegionDetailPage";
import CustomersPage from "@/pages/admin/CustomersPage";
import CustomerDetailsPage from "@/pages/admin/CustomerDetailsPage";
import ItemsPage from "@/pages/admin/ItemsPage";

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
            <Route path="/admin/customers" element={<CustomersPage />} />
            <Route path="/admin/items" element={<ItemsPage />} />
            <Route
              path="/admin/customers/:id"
              element={<CustomerDetailsPage />}
            />
            <Route path="/admin/banks" element={<BanksPage />} />
            <Route path="/admin/banks/:bankId" element={<BankDetailPage />} />
            <Route path="/admin/districts" element={<DistrictsPage />} />
            <Route
              path="/admin/districts/:districtId"
              element={<DistrictDetailPage />}
            />
            <Route
              path="/admin/districts/:districtId/regions/:regionId"
              element={<RegionDetailPage />}
            />
            <Route path="/admin/atms" element={<AtmsPage />} />
            <Route path="/admin/atms/:id" element={<ATMDetailsPage />} />
            <Route path="/admin/atms/:id/edit" element={<EditATMPage />} />
            <Route path="/admin/jobs" element={<JobsPage />} />
            <Route path="/admin/jobs/:jobId" element={<JobDetailsPage />} />
            <Route
              path="/admin/recurring-maintenance"
              element={<RecurringMaintenancePage />}
            />
            <Route path="/admin/amc" element={<AmcPage />} />
            <Route path="/admin/complaints" element={<ComplaintsPage />} />
            <Route
              path="/admin/complaints/:id"
              element={<ComplaintDetailsPage />}
            />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["supervisor"]} />}>
          <Route path="/supervisor" element={<SupervisorDashboardPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["employee"]} />}>
          <Route path="/employee" element={<EmployeeDashboardPage />} />
          <Route path="/employee/jobs" element={<EmployeeJobsPage />} />
          <Route
            path="/employee/jobs/:jobId"
            element={<JobDetailsPage readOnly backPath="/employee/jobs" />}
          />
        </Route>

        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
