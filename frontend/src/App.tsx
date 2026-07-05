import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import ChatPage from "./pages/ChatPage";
import LogsPage from "./pages/LogsPage";
import UsersPage from "./pages/UsersPage";
import TrainingPage from "./pages/TrainingPage";
import RecommendationsPage from "./pages/RecommendationsPage";
import StoragePage from "./pages/StoragePage";
import JobsPage from "./pages/JobsPage";
import SetupPage from "./pages/SetupPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { getAuth } from "./utils/auth";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = getAuth();
  return auth ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const auth = getAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (auth.role !== "admin") return <Navigate to="/chat" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<RequireAuth><SetupPage /></RequireAuth>} />
        <Route path="/chat" element={<RequireAuth><ChatPage /></RequireAuth>} />
        <Route path="/recommendations" element={<RequireAuth><RecommendationsPage /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAdmin><DashboardPage /></RequireAdmin>} />
        <Route path="/storage" element={<RequireAdmin><StoragePage /></RequireAdmin>} />
        <Route path="/jobs" element={<RequireAdmin><JobsPage /></RequireAdmin>} />
        <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
        <Route path="/logs" element={<RequireAdmin><LogsPage /></RequireAdmin>} />
        <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="/training" element={<RequireAdmin><TrainingPage /></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
