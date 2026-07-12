import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Activity, Camera, Cctv, FileText, LayoutDashboard, List, Settings, Tv } from "lucide-react";
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

function NavItem({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  );
}

export default function App() {
  const { theme, toggle } = useTheme();
  return (
    <ToastProvider>
      <BrowserRouter>
        <div className="flex h-screen bg-background">
          <aside className="w-56 flex-shrink-0 border-r bg-card flex flex-col">
            <div className="flex items-center gap-2 px-4 py-4 border-b">
              <Camera size={20} className="text-primary" />
              <span className="font-semibold text-sm">Camera Manager</span>
            </div>
            <nav className="flex flex-col gap-1 p-3 flex-1">
              <NavItem to="/"           icon={LayoutDashboard} label="Dashboard" />
              <NavItem to="/live"       icon={Tv}              label="Live View" />
              <NavItem to="/timeline"   icon={Camera}          label="Timeline" />
              <NavItem to="/cameras"    icon={Cctv}            label="Cameras" />
              <NavItem to="/recordings" icon={List}            label="Recordings" />
              <NavItem to="/activity"   icon={Activity}        label="Activity" />
              <NavItem to="/logs"       icon={FileText}        label="Logs" />
              <div className="mt-auto pt-4 border-t space-y-1">
                <p className="px-3 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                  Settings
                </p>
                <NavItem to="/settings/general"   icon={Settings} label="General" />
                <NavItem to="/settings/cameras"   icon={Camera}   label="Cameras" />
                <NavItem to="/settings/locations" icon={Settings} label="Locations" />
                <div className="pt-2">
                  <ThemeToggle theme={theme} onToggle={toggle} />
                </div>
              </div>
            </nav>
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
