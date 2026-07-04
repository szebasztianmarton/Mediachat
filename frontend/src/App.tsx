import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import ChatPage from "./pages/ChatPage";
import LogsPage from "./pages/LogsPage";
import UsersPage from "./pages/UsersPage";
import TrainingPage from "./pages/TrainingPage";
import { AUTH_KEY } from "./types";
import type { AuthData } from "./types";

function getAuthData(): AuthData | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AuthData;
    // Validate shape — discard old format that lacked userId
    if (!data.userId || !data.username || !data.role) return null;
    return data;
  } catch {
    return null;
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = getAuthData();
  return auth ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const auth = getAuthData();
  if (!auth) return <Navigate to="/login" replace />;
  if (auth.role !== "admin") return <Navigate to="/chat" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/chat" element={<RequireAuth><ChatPage /></RequireAuth>} />
      <Route path="/dashboard" element={<RequireAdmin><DashboardPage /></RequireAdmin>} />
      <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
      <Route path="/logs" element={<RequireAdmin><LogsPage /></RequireAdmin>} />
      <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
      <Route path="/training" element={<RequireAdmin><TrainingPage /></RequireAdmin>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
