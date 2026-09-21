import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Monitor,
  ClipboardList,
  CalendarCheck,
  MessageSquareWarning,
} from "lucide-react";

const navItems = [
  {
    label: "Dashboard",
    path: "/admin",
    icon: LayoutDashboard,
  },
  {
    label: "Employees",
    path: "/admin/employees",
    icon: Users,
  },
  {
    label: "ATMs",
    path: "/admin/atms",
    icon: Monitor,
  },
  {
    label: "Jobs",
    path: "/admin/jobs",
    icon: ClipboardList,
  },
  {
    label: "AMC",
    path: "/admin/amc",
    icon: CalendarCheck,
  },
  {
    label: "Complaints",
    path: "/admin/complaints",
    icon: MessageSquareWarning,
  },
];

export default function AdminSidebar() {
  return (
    <nav className="space-y-1 p-4">
      {navItems.map((item) => {
        const Icon = item.icon;

        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/admin"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "bg-black text-white"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`
            }
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
