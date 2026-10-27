import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BriefcaseBusiness,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";
import NotificationBell from "@/features/notifications/NotificationBell";
import {
  employeeLanguageClasses,
  useEmployeeLanguage,
  type EmployeeLanguage,
  type EmployeeTranslationKey,
} from "@/features/employee-portal/i18n";

const employeeNavigation: Array<{
  to: string;
  label: EmployeeTranslationKey;
  icon: typeof LayoutDashboard;
  end?: boolean;
}> = [
  { to: "/employee", label: "Dashboard navigation", icon: LayoutDashboard, end: true },
  { to: "/employee/jobs", label: "My Jobs navigation", icon: BriefcaseBusiness },
  { to: "/employee/location-tasks", label: "Location Tasks navigation", icon: MapPin },
  { to: "/employee/amcs", label: "My AMC visits navigation", icon: ClipboardCheck },
  { to: "/employee/attendance", label: "Attendance navigation", icon: Activity },
];

const pageTitles: Array<{
  matches: (path: string) => boolean;
  label: EmployeeTranslationKey;
}> = [
  { matches: (path: string) => path === "/employee", label: "Employee Dashboard" },
  { matches: (path: string) => path === "/employee/jobs", label: "My Jobs" },
  { matches: (path: string) => path === "/employee/location-tasks", label: "My Location Tasks" },
  { matches: (path: string) => path.startsWith("/employee/jobs/"), label: "Job Details" },
  { matches: (path: string) => path === "/employee/amcs", label: "My AMC Visits" },
  { matches: (path: string) => path.startsWith("/employee/amcs/"), label: "AMC Visit Details" },
  { matches: (path: string) => path.startsWith("/employee/attendance"), label: "Attendance" },
];

export default function EmployeeLayout() {
  const { logout } = useAuth();
  const { language, setLanguage, t } = useEmployeeLanguage();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia("(min-width: 768px)").matches,
  );
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const previousDesktopSidebarOpen = useRef(desktopSidebarOpen);
  const previousMobileSidebarOpen = useRef(mobileSidebarOpen);
  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen;
  const pageTitle =
    pageTitles.find(({ matches }) => matches(location.pathname))?.label ??
    "Employee portal";

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const updateIsDesktop = (event: MediaQueryListEvent) =>
      setIsDesktop(event.matches);
    mediaQuery.addEventListener("change", updateIsDesktop);
    return () => mediaQuery.removeEventListener("change", updateIsDesktop);
  }, []);

  useEffect(() => {
    if (previousDesktopSidebarOpen.current !== desktopSidebarOpen) {
      (desktopSidebarOpen ? closeButtonRef : openButtonRef).current?.focus();
      previousDesktopSidebarOpen.current = desktopSidebarOpen;
    }
  }, [desktopSidebarOpen]);

  useEffect(() => {
    if (previousMobileSidebarOpen.current !== mobileSidebarOpen) {
      (mobileSidebarOpen ? closeButtonRef : mobileMenuButtonRef).current?.focus();
      previousMobileSidebarOpen.current = mobileSidebarOpen;
    }
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen || isDesktop) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileSidebar();
        return;
      }

      if (event.key !== "Tab") return;
      const focusableElements = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-employee-sidebar] a[href], [data-employee-sidebar] button:not([disabled])',
        ),
      );
      const first = focusableElements[0];
      const last = focusableElements.at(-1);

      if (!first || !last) {
        event.preventDefault();
        closeButtonRef.current?.focus();
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
    };
  }, [closeMobileSidebar, isDesktop, mobileSidebarOpen]);

  const handleLogout = () => {
    closeMobileSidebar();
    void logout();
  };

  return (
    <div
      lang={language}
      className="employee-portal-shell min-h-screen min-w-0 bg-background text-foreground"
    >
      <button
        type="button"
        aria-label={t("Close navigation drawer")}
        aria-hidden={!mobileSidebarOpen || isDesktop}
        tabIndex={mobileSidebarOpen && !isDesktop ? 0 : -1}
        onClick={closeMobileSidebar}
        className={`fixed inset-0 z-30 bg-slate-950/45 transition-opacity duration-300 ease-in-out motion-reduce:transition-none md:hidden ${
          mobileSidebarOpen && !isDesktop
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        id="employee-navigation-drawer"
        data-employee-sidebar
        role={isDesktop ? "complementary" : "dialog"}
        aria-label={
          isDesktop ? t("Employee navigation") : t("Employee navigation drawer")
        }
        aria-modal={!isDesktop ? mobileSidebarOpen : undefined}
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh max-h-screen w-64 flex-col border-r border-slate-200 bg-white text-slate-900 shadow-xl transition-transform duration-300 ease-in-out motion-reduce:transition-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 ${
          isDesktop
            ? desktopSidebarOpen
              ? "pointer-events-auto translate-x-0"
              : "pointer-events-none -translate-x-full"
            : mobileSidebarOpen
              ? "pointer-events-auto translate-x-0"
              : "pointer-events-none -translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
              <BriefcaseBusiness className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-base font-bold tracking-tight">
                {t("ATM Maintenance")}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {t("Employee portal")}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t("Close navigation sidebar")}
            onClick={() => {
              if (isDesktop) setDesktopSidebarOpen(false);
              else closeMobileSidebar();
            }}
            className="inline-flex size-11 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <nav
          aria-label={t("Employee navigation")}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
        >
          <p className="px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("Main menu")}
          </p>
          <ul className="space-y-1.5">
            {employeeNavigation.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={() => {
                    if (!isDesktop) closeMobileSidebar();
                  }}
                  className={({ isActive }) =>
                    `flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isActive
                        ? "bg-blue-50 text-blue-700 shadow-sm dark:bg-blue-950/70 dark:text-blue-300"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-teal-700 dark:bg-slate-800 dark:text-teal-300"
                        }`}
                      >
                        <Icon className="size-4.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 break-words leading-5 [overflow-wrap:anywhere]">
                        {t(label)}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
          <div>
            <p className="mb-2 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              {t("Language")}
            </p>
            <div
              role="group"
              aria-label={t("Language preference")}
              className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
            >
              {(["ta", "en"] as const).map((option: EmployeeLanguage) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={language === option}
                  onClick={() => setLanguage(option)}
                  className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    language === option
                      ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-200"
                      : "text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  {option === "ta" ? "தமிழ்" : "English"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t("Logout")}
          </button>
        </div>
      </aside>

      <div
        inert={mobileSidebarOpen && !isDesktop}
        className={`flex min-h-screen min-w-0 flex-col transition-[margin] duration-300 ease-in-out motion-reduce:transition-none ${
          isDesktop && desktopSidebarOpen ? "md:ml-64" : "md:ml-0"
        }`}
      >
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {!isDesktop && (
              <button
                ref={mobileMenuButtonRef}
                type="button"
                aria-label={t("Open navigation menu")}
                aria-expanded={mobileSidebarOpen}
                aria-controls="employee-navigation-drawer"
                onClick={() => setMobileSidebarOpen(true)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
              >
                <Menu aria-hidden="true" className="size-5" />
              </button>
            )}
            {isDesktop && !desktopSidebarOpen && (
              <button
                ref={openButtonRef}
                type="button"
                aria-label={t("Open navigation sidebar")}
                onClick={() => setDesktopSidebarOpen(true)}
                className="hidden size-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 md:inline-flex"
              >
                <PanelLeftOpen aria-hidden="true" className="size-5" />
              </button>
            )}
            <h2 className={`min-w-0 text-base font-semibold sm:text-lg ${employeeLanguageClasses(language, "truncate", "break-words leading-5")}`}>
              {t(pageTitle)}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 sm:inline-flex">
              {t("Field service")}
            </span>
            <NotificationBell />
          </div>
        </header>

        <div className={`min-w-0 flex-1 bg-slate-50 dark:bg-slate-900 ${employeeLanguageClasses(language, "p-4 sm:p-6 lg:p-8", "p-3 sm:p-5 lg:p-6")}`}>
          <div className="mx-auto w-full max-w-7xl min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
