import { createContext, useContext } from "react";

/** Coarse auth state rendered by `App`. */
export type AuthStatus = "loading" | "anonymous" | "authenticated";

/** Claims the console cares about, flattened from the ID token. */
export interface AuthUser {
  readonly subject: string;
  readonly name?: string;
  readonly email?: string;
  readonly username?: string;
  readonly roles: readonly string[];
}

/** Value exposed by {@link useAuth}. */
export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: AuthUser | null;
  readonly accessToken: string | null;
  /** Last auth error (provider error, failed exchange, expired session). */
  readonly error: string | null;
  /** Redirect the browser to the identity provider. */
  login: () => void;
  /** Clear the local session and sign out of the identity provider. */
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Access the current auth state; throws outside `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within <AuthProvider>.");
  }
  return context;
}
