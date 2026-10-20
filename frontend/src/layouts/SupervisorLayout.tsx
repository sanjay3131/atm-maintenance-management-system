import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";

const navigation = [
  { to: "/supervisor", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/supervisor/employees", label: "Employees", icon: Users },
  { to: "/supervisor/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { to: "/supervisor/amc", label: "AMC", icon: CalendarDays },
];

const pageTitles: Record<string, string> = {
  "/supervisor": "Supervisor dashboard",
  "/supervisor/employees": "Assigned employees",
  "/supervisor/jobs": "Job monitoring",
  "/supervisor/amc": "AMC monitoring",
};

export default function SupervisorLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 768px)").matches,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const pageTitle =
    pageTitles[location.pathname] ??
    (location.pathname.startsWith("/supervisor/employees/")
      ? "Employee details"
      : location.pathname.startsWith("/supervisor/jobs/")
        ? "Job details"
        : location.pathname.startsWith("/supervisor/amc/")
          ? "AMC details"
        : "Supervisor portal");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const updateIsDesktop = (event: MediaQueryListEvent) =>
      setIsDesktop(event.matches);
    mediaQuery.addEventListener("change", updateIsDesktop);
    return () => mediaQuery.removeEventListener("change", updateIsDesktop);
  }, []);

  useEffect(() => {
    if (!mobileOpen || isDesktop) return;
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-supervisor-sidebar] a[href], [data-supervisor-sidebar] button:not([disabled])",
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      menuButton?.focus();
    };
  }, [isDesktop, mobileOpen]);

  const closeDrawer = () => setMobileOpen(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <button
        type="button"
        aria-label="Close supervisor navigation"
        aria-hidden={!mobileOpen}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={closeDrawer}
        className={`fixed inset-0 z-30 bg-slate-950/45 transition-opacity motion-reduce:transition-none md:hidden ${
          mobileOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        id="supervisor-navigation"
        data-supervisor-sidebar
        role={isDesktop ? "complementary" : "dialog"}
        aria-label="Supervisor navigation"
        aria-modal={!isDesktop ? mobileOpen : undefined}
        aria-hidden={!isDesktop && !mobileOpen}
        inert={!isDesktop && !mobileOpen}
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform motion-reduce:transition-none md:translate-x-0 md:shadow-none ${
          isDesktop
            ? "pointer-events-auto translate-x-0"
            : mobileOpen
              ? "pointer-events-auto translate-x-0"
              : "pointer-events-none -translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-700 text-white shadow-sm">
              <Activity className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-bold tracking-tight">ATM Maintenance</p>
              <p className="text-xs text-slate-500">Supervisor portal</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close navigation drawer"
            onClick={closeDrawer}
            className="inline-flex size-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Supervisor navigation" className="flex-1 px-3 py-5">
          <p className="px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <ul className="space-y-1.5">
            {navigation.map(({ to, label, icon: Icon, end }) => {
              const isAvailable =
                to === "/supervisor" ||
                to === "/supervisor/employees" ||
                to === "/supervisor/jobs" ||
                to === "/supervisor/amc";
              return (
                <li key={to}>
                  {isAvailable ? (
                    <NavLink
                      to={to}
                      end={end}
                      onClick={closeDrawer}
                      className={({ isActive }) =>
                        `flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                          isActive
                            ? "bg-blue-50 text-blue-800"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={`grid size-9 place-items-center rounded-lg ${
                              isActive
                                ? "bg-blue-700 text-white"
                                : "bg-slate-100 text-teal-700"
                            }`}
                          >
                            <Icon className="size-4.5" aria-hidden="true" />
                          </span>
                          {label}
                        </>
                      )}
                    </NavLink>
                  ) : (
                    <div
                      aria-disabled="true"
                      title={`${label} view will be available in a future phase`}
                      className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-400"
                    >
                      <span className="grid size-9 place-items-center rounded-lg bg-slate-50 text-slate-400">
                        <Icon className="size-4.5" aria-hidden="true" />
                      </span>
                      <span className="flex-1">{label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Soon
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-teal-100 text-sm font-bold text-teal-800">
              {(user?.firstName?.[0] || "S").toLocaleUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {[user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
                  "Supervisor"}
              </p>
              <p className="text-xs text-slate-500">Supervisor</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col md:ml-72">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Open supervisor navigation"
            aria-expanded={mobileOpen}
            aria-controls="supervisor-navigation"
            onClick={() => setMobileOpen(true)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <h1 className="truncate text-base font-semibold sm:text-lg">
              {pageTitle}
            </h1>
            <span className="hidden rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 sm:inline-flex">
              Operations overview
            </span>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
