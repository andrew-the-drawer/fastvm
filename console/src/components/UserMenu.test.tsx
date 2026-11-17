import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthContext } from "../auth/context";
import type { AuthContextValue } from "../auth/context";
import { UserMenu } from "./UserMenu";
import { installDomStubs } from "./test-dom";

afterEach(cleanup);

function renderUserMenu(overrides: Partial<AuthContextValue> = {}) {
  const logout = vi.fn();
  const auth: AuthContextValue = {
    status: "authenticated",
    user: { subject: "sub", name: "Demo User", email: "demo@example.com", roles: ["admin"] },
    accessToken: "token",
    error: null,
    login: vi.fn(),
    logout,
    ...overrides,
  };
  const utils = render(
    <AuthContext.Provider value={auth}>
      <UserMenu />
    </AuthContext.Provider>,
  );
  return { ...utils, auth, logout };
}

describe("UserMenu", () => {
  it("shows identity and roles, then signs out", async () => {
    installDomStubs();
    const { logout } = renderUserMenu();

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(await screen.findByText("demo@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sign out"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("falls back to the subject when no profile claims exist", () => {
    installDomStubs();
    renderUserMenu({
      user: { subject: "service-account", roles: [] },
    });
    expect(screen.getByText("service-account")).toBeInTheDocument();
    expect(screen.getByText("SA")).toBeInTheDocument();
  });
});
