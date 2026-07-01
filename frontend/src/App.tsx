import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Activity, Camera, FileText, LayoutDashboard, List, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import Dashboard from "@/pages/Dashboard";
import Timeline from "@/pages/Timeline";
import Recordings from "@/pages/Recordings";
import LogsPage from "@/pages/Logs";
import ActivityPage from "@/pages/Activity";
import CamerasSettings from "@/pages/settings/Cameras";
import LocationsSettings from "@/pages/settings/Locations";

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
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-background">
        <aside className="w-56 flex-shrink-0 border-r bg-card flex flex-col">
          <div className="flex items-center gap-2 px-4 py-4 border-b">
            <Camera size={20} className="text-primary" />
            <span className="font-semibold text-sm">Camera Manager</span>
          </div>
          <nav className="flex flex-col gap-1 p-3 flex-1">
            <NavItem to="/"           icon={LayoutDashboard} label="Dashboard" />
            <NavItem to="/timeline"   icon={Camera}          label="Timeline" />
            <NavItem to="/recordings" icon={List}            label="Recordings" />
            <NavItem to="/activity"   icon={Activity}        label="Activity" />
            <NavItem to="/logs"       icon={FileText}        label="Logs" />
            <div className="mt-auto pt-4 border-t">
              <p className="px-3 py-1 text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-1">
                Settings
              </p>
              <NavItem to="/settings/cameras"   icon={Camera}   label="Cameras" />
              <NavItem to="/settings/locations" icon={Settings} label="Locations" />
            </div>
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/"                   element={<Dashboard />} />
            <Route path="/timeline"           element={<Timeline />} />
            <Route path="/recordings"         element={<Recordings />} />
            <Route path="/activity"           element={<ActivityPage />} />
            <Route path="/logs"               element={<LogsPage />} />
            <Route path="/settings/cameras"   element={<CamerasSettings />} />
            <Route path="/settings/locations" element={<LocationsSettings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
