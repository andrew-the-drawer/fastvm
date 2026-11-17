import { App as AntdApp, ConfigProvider, Flex, Spin } from "antd";
import { useAuth } from "./auth/context";
import { BoltIcon } from "./components/icons";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import { buildTheme } from "./theme";
import { useTheme } from "./theme/theme-mode";

/**
 * Root view. `AuthProvider` owns the OIDC state machine; this component only
 * picks the screen: splash while a session is being restored, login when
 * anonymous, dashboard when authenticated. The resolved theme comes from
 * `ThemeProvider` and drives both antd's ConfigProvider and the CSS layer.
 */
function App() {
  const auth = useAuth();
  const { resolvedMode } = useTheme();

  return (
    <ConfigProvider theme={buildTheme(resolvedMode)}>
      <AntdApp className="app-root">
        {auth.status === "loading" ? (
          <Flex align="center" justify="center" vertical gap={16} className="splash-screen">
            <span className="brand-mark brand-mark--splash" aria-hidden="true">
              <BoltIcon />
            </span>
            <Spin size="large" />
            <span className="splash-copy">Restoring session…</span>
          </Flex>
        ) : auth.status === "anonymous" ? (
          <LoginPage />
        ) : (
          <DashboardPage />
        )}
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
