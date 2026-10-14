import {
  BriefcaseBusiness,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";

const links = [
  { to: "/customer", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/customer/atms", label: "ATMs", icon: Building2 },
  { to: "/customer/jobs", label: "Service history", icon: BriefcaseBusiness },
  { to: "/customer/amcs", label: "AMC records", icon: Building2 },
  { to: "/customer/reports", label: "Reports", icon: FileSpreadsheet },
];

export default function CustomerPortalLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-lg font-semibold tracking-tight">ATM Maintenance</p>
            <p className="text-sm text-muted-foreground">Customer portal</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.firstName} {user?.lastName}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <nav
          aria-label="Customer portal navigation"
          className="flex gap-2 overflow-x-auto border-b py-3"
        >
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="py-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
