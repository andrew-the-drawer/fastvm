import { useAuth } from "./auth/context";
import { BoltIcon } from "./components/icons";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import { Spinner, ToastProvider } from "./ui";

/** First-paint splash while the OIDC session is restored. */
function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <span className="grid size-12 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm">
        <BoltIcon className="size-6" />
      </span>
      <Spinner className="size-5 text-indigo-600 dark:text-indigo-400" />
      <span className="text-sm text-gray-600 dark:text-gray-400">Restoring session…</span>
    </div>
  );
}

/**
 * Root view. `AuthProvider` owns the OIDC state machine; this component only
 * picks the screen: splash while a session is being restored, login when
 * anonymous, dashboard when authenticated.
 */
function App() {
  const auth = useAuth();

  return (
    <ToastProvider>
      {auth.status === "loading" ? (
        <Splash />
      ) : auth.status === "anonymous" ? (
        <LoginPage />
      ) : (
        <DashboardPage />
      )}
    </ToastProvider>
  );
}

export default App;
