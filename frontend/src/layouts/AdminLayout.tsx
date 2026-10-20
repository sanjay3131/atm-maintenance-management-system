import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, PanelLeftOpen, X } from "lucide-react";
import { Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia("(min-width: 768px)").matches,
  );
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const previousDesktopSidebarOpen = useRef(desktopSidebarOpen);
  const previousMobileSidebarOpen = useRef(mobileSidebarOpen);
  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen;

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
      (mobileSidebarOpen
        ? closeButtonRef
        : mobileMenuButtonRef
      ).current?.focus();
      previousMobileSidebarOpen.current = mobileSidebarOpen;
    }
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen || isDesktop) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileSidebar();
        return;
      }

      if (event.key !== "Tab") return;
      const focusableElements = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-mobile-sidebar] a[href], [data-mobile-sidebar] button:not([disabled])",
        ),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, isDesktop, mobileSidebarOpen]);

  return (
    <div className="min-h-screen bg-gray-50">
      <button
        type="button"
        aria-label="Close navigation drawer"
        aria-hidden={!mobileSidebarOpen || isDesktop}
        tabIndex={mobileSidebarOpen && !isDesktop ? 0 : -1}
        onClick={closeMobileSidebar}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 ease-in-out motion-reduce:transition-none md:hidden ${
          mobileSidebarOpen && !isDesktop
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        id="admin-navigation-drawer"
        data-mobile-sidebar
        role={isDesktop ? "complementary" : "dialog"}
        aria-label={isDesktop ? "Admin navigation" : "Admin navigation drawer"}
        aria-modal={!isDesktop ? mobileSidebarOpen : undefined}
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh max-h-screen w-64 flex-col border-r bg-white transition-transform duration-300 ease-in-out motion-reduce:transition-none ${
          isDesktop
            ? desktopSidebarOpen
              ? "pointer-events-auto translate-x-0"
              : "pointer-events-none -translate-x-full"
            : mobileSidebarOpen
              ? "pointer-events-auto translate-x-0"
              : "pointer-events-none -translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-start justify-between border-b p-5">
          <div>
            <h1 className="text-lg font-bold">Sendhur Engineering</h1>
            <p className="text-sm text-gray-500">Admin Panel</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close navigation sidebar"
            onClick={() => {
              if (isDesktop) setDesktopSidebarOpen(false);
              else closeMobileSidebar();
            }}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="text-xs font-semibold uppercase text-gray-400">
            <span className="block px-4 pt-4">Overview</span>
          </p>
          <AdminSidebar
            onNavigate={isDesktop ? undefined : closeMobileSidebar}
          />
        </div>
      </aside>

      <div
        className={`flex min-h-screen min-w-0 flex-col transition-[margin] duration-300 ease-in-out motion-reduce:transition-none ${
          isDesktop && desktopSidebarOpen ? "md:ml-64" : "md:ml-0"
        }`}
      >
        <header className="flex h-16 items-center justify-between border-b bg-white px-6">
          <div className="flex items-center gap-3">
            {!isDesktop && (
              <button
                ref={mobileMenuButtonRef}
                type="button"
                aria-label="Open navigation menu"
                aria-expanded={mobileSidebarOpen}
                aria-controls="admin-navigation-drawer"
                onClick={() => setMobileSidebarOpen(true)}
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 md:hidden"
              >
                <Menu aria-hidden="true" className="size-5" />
              </button>
            )}
            {isDesktop && !desktopSidebarOpen && (
              <button
                ref={openButtonRef}
                type="button"
                aria-label="Open navigation sidebar"
                onClick={() => setDesktopSidebarOpen(true)}
                className="hidden rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 md:inline-flex"
              >
                <PanelLeftOpen aria-hidden="true" className="size-5" />
              </button>
            )}
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

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
