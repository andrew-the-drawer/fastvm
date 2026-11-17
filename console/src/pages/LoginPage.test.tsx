import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthContext } from "../auth/context";
import type { AuthContextValue } from "../auth/context";
import { installDomStubs } from "../components/test-dom";
import LoginPage from "./LoginPage";

afterEach(cleanup);

function renderLogin(overrides: Partial<AuthContextValue> = {}) {
  const auth: AuthContextValue = {
    status: "anonymous",
    user: null,
    accessToken: null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <AuthContext.Provider value={auth}>
      <LoginPage />
    </AuthContext.Provider>,
  );
  return { ...utils, auth };
}

describe("LoginPage", () => {
  it("renders the product pitch and starts the OIDC redirect", () => {
    installDomStubs();
    const { auth } = renderLogin();

    expect(screen.getByRole("heading", { name: /Micro-VMs that sleep/i })).toBeInTheDocument();
    expect(screen.getAllByText(/fastvm/i).length).toBeGreaterThan(0);

    const button = screen.getByRole("button", { name: "Sign in with Keycloak" });
    fireEvent.click(button);

    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Redirecting to Keycloak/ })).toBeInTheDocument();
  });

  it("surfaces authentication errors", () => {
    installDomStubs();
    renderLogin({ error: "Your session has expired. Please sign in again." });

    expect(screen.getByText("Sign-in failed")).toBeInTheDocument();
    expect(screen.getByText(/Your session has expired/)).toBeInTheDocument();
  });

  it("does not render credential fields (OIDC handles auth)", () => {
    installDomStubs();
    renderLogin();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });
});
