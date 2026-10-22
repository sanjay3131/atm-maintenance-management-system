import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import LoginPage from "@/pages/auth/LoginPage";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import SupervisorDashboardPage from "@/pages/supervisor/SupervisorDashboardPage";
import SupervisorEmployeesPage from "@/pages/supervisor/SupervisorEmployeesPage";
import SupervisorEmployeeDetailsPage from "@/pages/supervisor/SupervisorEmployeeDetailsPage";
import SupervisorJobsPage from "@/pages/supervisor/SupervisorJobsPage";
import SupervisorJobDetailsPage from "@/pages/supervisor/SupervisorJobDetailsPage";
import SupervisorAMCsPage from "@/pages/supervisor/SupervisorAMCsPage";
import SupervisorAMCDetailsPage from "@/pages/supervisor/SupervisorAMCDetailsPage";
import EmployeeDashboardPage from "@/pages/employee/EmployeeDashboardPage";
import ProtectedRoute from "@/routes/ProtectedRoute";
import AdminLayout from "@/layouts/AdminLayout";
import EmployeeLayout from "@/layouts/EmployeeLayout";
import SupervisorLayout from "@/layouts/SupervisorLayout";
import EmployeesPage from "@/pages/admin/EmployeesPage";
import EmployeeDetailsPage from "@/pages/admin/EmployeeDetailsPage";
import AtmsPage from "@/pages/admin/AtmsPage";
import JobsPage from "@/pages/admin/JobsPage";
import AmcPage from "@/pages/admin/AmcPage";
import AdminAMCDetailsPage from "@/pages/admin/AdminAMCDetailsPage";
import ComplaintsPage from "@/pages/admin/ComplaintsPage";
import ComplaintDetailsPage from "@/pages/admin/ComplaintDetailsPage";
import ATMDetailsPage from "@/pages/admin/ATMDetailsPage";
import EditATMPage from "@/pages/admin/EditATMPage";
import JobDetailsPage from "@/pages/admin/JobDetailsPage";
import RecurringMaintenancePage from "@/pages/admin/RecurringMaintenancePage";
import EmployeeJobsPage from "@/pages/employee/EmployeeJobsPage";
import EmployeeAMCsPage from "@/pages/employee/EmployeeAMCsPage";
import EmployeeAMCDetailsPage from "@/pages/employee/EmployeeAMCDetailsPage";
import EmployeeAttendancePage from "@/pages/employee/EmployeeAttendancePage";
import EmployeeLanguageProvider from "@/features/employee-portal/EmployeeLanguageProvider";
import BanksPage from "@/pages/admin/BanksPage";
import BankDetailPage from "@/pages/admin/BankDetailPage";
import DistrictsPage from "@/pages/admin/DistrictsPage";
import DistrictDetailPage from "@/pages/admin/DistrictDetailPage";
import RegionDetailPage from "@/pages/admin/RegionDetailPage";
import CustomersPage from "@/pages/admin/CustomersPage";
import CustomerDetailsPage from "@/pages/admin/CustomerDetailsPage";
import ItemsPage from "@/pages/admin/ItemsPage";
import AdminAttendancePage from "@/pages/admin/AdminAttendancePage";
import ATMLocationRequestsPage from "@/pages/admin/ATMLocationRequestsPage";
import ATMLocationRequestDetailsPage from "@/pages/admin/ATMLocationRequestDetailsPage";
import CustomerPortalLayout from "@/layouts/CustomerPortalLayout";
import {
  CustomerAMCDetailsPage,
  CustomerAMCsPage,
  CustomerATMDetailsPage,
  CustomerATMsPage,
  CustomerDashboardPage,
  CustomerJobDetailsPage,
  CustomerJobsPage,
  CustomerReportsPage,
} from "@/pages/customer/CustomerPortalPages";

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
            <Route
              path="/admin/attendance"
              element={<AdminAttendancePage />}
            />
            <Route path="/admin/employees" element={<EmployeesPage />} />
            <Route
              path="/admin/employees/:employeeId"
              element={<EmployeeDetailsPage />}
            />
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
            <Route
              path="/admin/location-requests"
              element={<ATMLocationRequestsPage />}
            />
            <Route
              path="/admin/location-requests/:requestId"
              element={<ATMLocationRequestDetailsPage />}
            />
            <Route path="/admin/jobs" element={<JobsPage />} />
            <Route path="/admin/jobs/:jobId" element={<JobDetailsPage />} />
            <Route
              path="/admin/recurring-maintenance"
              element={<RecurringMaintenancePage />}
            />
            <Route path="/admin/amc" element={<AmcPage />} />
            <Route
              path="/admin/amc/:amcId"
              element={<AdminAMCDetailsPage />}
            />
            <Route path="/admin/complaints" element={<ComplaintsPage />} />
            <Route
              path="/admin/complaints/:id"
              element={<ComplaintDetailsPage />}
            />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["supervisor"]} />}>
          <Route element={<SupervisorLayout />}>
            <Route path="/supervisor" element={<SupervisorDashboardPage />} />
            <Route
              path="/supervisor/employees"
              element={<SupervisorEmployeesPage />}
            />
            <Route
              path="/supervisor/employees/:employeeId"
              element={<SupervisorEmployeeDetailsPage />}
            />
            <Route path="/supervisor/jobs" element={<SupervisorJobsPage />} />
            <Route
              path="/supervisor/jobs/:jobId"
              element={<SupervisorJobDetailsPage />}
            />
            <Route path="/supervisor/amc" element={<SupervisorAMCsPage />} />
            <Route
              path="/supervisor/amc/:amcId"
              element={<SupervisorAMCDetailsPage />}
            />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["employee"]} />}>
          <Route
            element={
              <EmployeeLanguageProvider>
                <EmployeeLayout />
              </EmployeeLanguageProvider>
            }
          >
            <Route path="/employee" element={<EmployeeDashboardPage />} />
            <Route
              path="/employee/attendance"
              element={<EmployeeAttendancePage />}
            />
            <Route path="/employee/jobs" element={<EmployeeJobsPage />} />
            <Route path="/employee/amcs" element={<EmployeeAMCsPage />} />
            <Route
              path="/employee/amcs/:amcId"
              element={<EmployeeAMCDetailsPage />}
            />
            <Route
              path="/employee/jobs/:jobId"
              element={<JobDetailsPage readOnly backPath="/employee/jobs" />}
            />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["customer"]} />}>
          <Route element={<CustomerPortalLayout />}>
            <Route path="/customer" element={<CustomerDashboardPage />} />
            <Route path="/customer/atms" element={<CustomerATMsPage />} />
            <Route
              path="/customer/atms/:atmId"
              element={<CustomerATMDetailsPage />}
            />
            <Route path="/customer/jobs" element={<CustomerJobsPage />} />
            <Route
              path="/customer/jobs/:jobId"
              element={<CustomerJobDetailsPage />}
            />
            <Route path="/customer/amcs" element={<CustomerAMCsPage />} />
            <Route
              path="/customer/reports"
              element={<CustomerReportsPage />}
            />
            <Route
              path="/customer/amcs/:amcId"
              element={<CustomerAMCDetailsPage />}
            />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
