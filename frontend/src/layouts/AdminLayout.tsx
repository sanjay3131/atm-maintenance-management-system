import { Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="hidden w-64 border-r bg-white md:block">
        <div className="border-b p-5">
          <h1 className="text-lg font-bold">ATM Maintenance</h1>

          <p className="text-sm text-gray-500">Admin Panel</p>
        </div>

        <nav className="p-4">
          <p className="text-xs font-semibold uppercase text-gray-400">
            Overview
          </p>
          <AdminSidebar />

          {/* Navigation will be added next */}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-16 items-center justify-between border-b bg-white px-6">
          <div>
            <h2 className="font-semibold">Admin</h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">
                {user?.firstName} {user?.lastName}
              </p>

              <p className="text-xs text-gray-500">{user?.userType}</p>
            </div>

            <button
              onClick={logout}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-100"
            >
              Logout
            </button>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
