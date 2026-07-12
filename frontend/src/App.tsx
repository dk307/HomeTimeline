import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Activity, Camera, Cctv, FileText, LayoutDashboard, List, PanelLeftClose, PanelLeftOpen, Settings, Tv } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/hooks/useToast";
import { useTheme, ThemeToggle } from "@/hooks/useTheme";
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

function NavItem({ to, icon: Icon, label, collapsed }: { to: string; icon: React.ElementType; label: string; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md text-sm font-medium transition-colors",
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

export default function App() {
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <div className="flex h-screen bg-background">
          <aside className={cn("flex-shrink-0 border-r bg-card flex flex-col transition-[width] duration-200", collapsed ? "w-14" : "w-56")}>
            <div className={cn("flex items-center border-b", collapsed ? "justify-center px-2 py-3" : "gap-2 px-4 py-4")}>
              {!collapsed && <Camera size={20} className="text-primary" />}
              {!collapsed && <span className="font-semibold text-sm">Camera Manager</span>}
              {collapsed && <Camera size={20} className="text-primary" />}
            </div>
            <nav className="flex flex-col gap-1 p-3 flex-1">
              <NavItem to="/"           icon={LayoutDashboard} label="Dashboard"  collapsed={collapsed} />
              <NavItem to="/live"       icon={Tv}              label="Live View"  collapsed={collapsed} />
              <NavItem to="/timeline"   icon={Camera}          label="Timeline"   collapsed={collapsed} />
              <NavItem to="/cameras"    icon={Cctv}            label="Cameras"    collapsed={collapsed} />
              <NavItem to="/recordings" icon={List}            label="Recordings" collapsed={collapsed} />
              <NavItem to="/activity"   icon={Activity}        label="Activity"   collapsed={collapsed} />
              <NavItem to="/logs"       icon={FileText}        label="Logs"       collapsed={collapsed} />
              <div className="mt-auto pt-4 border-t space-y-1">
                {!collapsed && (
                  <p className="px-3 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                    Settings
                  </p>
                )}
                <NavItem to="/settings/general"   icon={Settings} label="General"   collapsed={collapsed} />
                <NavItem to="/settings/cameras"   icon={Camera}   label="Cameras"   collapsed={collapsed} />
                <NavItem to="/settings/locations" icon={Settings} label="Locations" collapsed={collapsed} />
                <div className={cn("pt-2", collapsed && "flex justify-center")}>
                  <ThemeToggle theme={theme} onToggle={toggle} collapsed={collapsed} />
                </div>
              </div>
            </nav>
            <button
              onClick={toggleSidebar}
              className="flex items-center justify-center border-t p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </aside>

          <main className="flex-1 overflow-auto">
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
      </BrowserRouter>
    </ToastProvider>
  );
}
