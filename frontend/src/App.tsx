import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import { Activity, Camera, Cctv, FileText, LayoutDashboard, List, Menu, PanelLeftClose, PanelLeftOpen, Settings, Tv, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/hooks/useToast";
import { ThemeToggle } from "@/components/ThemeToggle";
import Dashboard from "@/pages/Dashboard";
import Live from "@/pages/Live";
import Timeline from "@/pages/Timeline";
import CamerasList from "@/pages/Cameras";
import CameraDetail from "@/pages/CameraDetail";
import Recordings from "@/pages/Recordings";
import LogsPage from "@/pages/Logs";
import ActivityPage from "@/pages/Activity";
import CamerasSettings from "@/pages/settings/Cameras";
import LocationsSettings from "@/pages/settings/Locations";
import GeneralSettings from "@/pages/settings/General";

function NavItem({ to, icon: Icon, label, collapsed, onClick }: { to: string; icon: React.ElementType; label: string; collapsed: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md text-sm font-medium transition-colors min-h-[44px]",
          collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )
      }
    >
      <Icon size={16} />
      {!collapsed && label}
    </NavLink>
  );
}

function SidebarContent({ collapsed, onNavClick }: { collapsed: boolean; onNavClick?: () => void }) {
  return (
    <>
      <div className={cn("flex items-center border-b", collapsed ? "justify-center px-2 py-3" : "gap-2 px-4 py-4")}>
        {!collapsed && <Camera size={20} className="text-primary" />}
        {!collapsed && <span className="font-semibold text-sm">HomeTimeline</span>}
        {collapsed && <Camera size={20} className="text-primary" />}
      </div>
      <nav className="flex flex-col gap-1 p-3 flex-1">
        <NavItem to="/"           icon={LayoutDashboard} label="Dashboard"  collapsed={collapsed} onClick={onNavClick} />
        <NavItem to="/live"       icon={Tv}              label="Live View"  collapsed={collapsed} onClick={onNavClick} />
        <NavItem to="/timeline"   icon={Camera}          label="Timeline"   collapsed={collapsed} onClick={onNavClick} />
        <NavItem to="/cameras"    icon={Cctv}            label="Cameras"    collapsed={collapsed} onClick={onNavClick} />
        <NavItem to="/recordings" icon={List}            label="Recordings" collapsed={collapsed} onClick={onNavClick} />
        <NavItem to="/activity"   icon={Activity}        label="Activity"   collapsed={collapsed} onClick={onNavClick} />
        <NavItem to="/logs"       icon={FileText}        label="Logs"       collapsed={collapsed} onClick={onNavClick} />
        <div className="mt-auto pt-4 border-t space-y-1">
          {!collapsed && (
            <p className="px-3 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
              Settings
            </p>
          )}
          <NavItem to="/settings/general"   icon={Settings} label="General"   collapsed={collapsed} onClick={onNavClick} />
          <NavItem to="/settings/cameras"   icon={Camera}   label="Cameras"   collapsed={collapsed} onClick={onNavClick} />
          <NavItem to="/settings/locations" icon={Settings} label="Locations" collapsed={collapsed} onClick={onNavClick} />
          <div className={cn("pt-2", collapsed && "flex justify-center")}>
            <ThemeToggle collapsed={collapsed} />
          </div>
        </div>
      </nav>
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center border-t p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors min-h-[44px]"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
    </>
  );
}

let toggleSidebar: () => void = () => {};

function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Close mobile sidebar on escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === "Escape") setMobileOpen(false); }
    if (mobileOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  }, []);

  const handleMobileNav = useCallback(() => { setMobileOpen(false); }, []);

  toggleSidebar = handleToggle;

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className={cn("hidden md:flex flex-shrink-0 border-r bg-card flex-col transition-[width] duration-200", collapsed ? "w-14" : "w-56")}>
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 z-50 w-56 bg-card border-r flex flex-col transition-transform duration-200">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-4">
              <div className="flex items-center gap-2">
                <Camera size={20} className="text-primary" />
                <span className="font-semibold text-sm">HomeTimeline</span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-1 p-3 flex-1">
              <NavItem to="/"           icon={LayoutDashboard} label="Dashboard"  collapsed={false} onClick={handleMobileNav} />
              <NavItem to="/live"       icon={Tv}              label="Live View"  collapsed={false} onClick={handleMobileNav} />
              <NavItem to="/timeline"   icon={Camera}          label="Timeline"   collapsed={false} onClick={handleMobileNav} />
              <NavItem to="/cameras"    icon={Cctv}            label="Cameras"    collapsed={false} onClick={handleMobileNav} />
              <NavItem to="/recordings" icon={List}            label="Recordings" collapsed={false} onClick={handleMobileNav} />
              <NavItem to="/activity"   icon={Activity}        label="Activity"   collapsed={false} onClick={handleMobileNav} />
              <NavItem to="/logs"       icon={FileText}        label="Logs"       collapsed={false} onClick={handleMobileNav} />
              <div className="mt-auto pt-4 border-t space-y-1">
                <p className="px-3 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                  Settings
                </p>
                <NavItem to="/settings/general"   icon={Settings} label="General"   collapsed={false} onClick={handleMobileNav} />
                <NavItem to="/settings/cameras"   icon={Camera}   label="Cameras"   collapsed={false} onClick={handleMobileNav} />
                <NavItem to="/settings/locations" icon={Settings} label="Locations" collapsed={false} onClick={handleMobileNav} />
                <div className="pt-2">
                  <ThemeToggle collapsed={false} />
                </div>
              </div>
            </nav>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile top bar */}
        <div className="flex md:hidden items-center border-b bg-card px-4 py-2.5 gap-3 shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-primary" />
            <span className="font-semibold text-sm">HomeTimeline</span>
          </div>
        </div>

        <main className="flex-1 min-h-0 overflow-auto">
          <Routes>
            <Route path="/"                   element={<Dashboard />} />
            <Route path="/live"               element={<Live />} />
            <Route path="/timeline"           element={<Timeline />} />
            <Route path="/cameras"            element={<CamerasList />} />
            <Route path="/cameras/:id"        element={<CameraDetail />} />
            <Route path="/recordings"         element={<Recordings />} />
            <Route path="/activity"           element={<ActivityPage />} />
            <Route path="/logs"               element={<LogsPage />} />
            <Route path="/settings/general"   element={<GeneralSettings />} />
            <Route path="/settings/cameras"   element={<CamerasSettings />} />
            <Route path="/settings/locations" element={<LocationsSettings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ToastProvider>
  );
}
