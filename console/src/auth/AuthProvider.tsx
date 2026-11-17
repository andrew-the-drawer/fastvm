/**
 * OIDC authentication state for the console.
 *
 * Flow: `login()` redirects to Keycloak with an authorization-code + PKCE
 * request. On return, the callback is exchanged on mount, the session is kept
 * in sessionStorage, and expired tokens are refreshed silently. `logout()` clears
 * the local session and performs RP-initiated logout at Keycloak.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { oauthConfig } from "../lib/config";
import { AuthContext, type AuthStatus, type AuthUser, type AuthContextValue } from "./context";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  cleanCallbackUrl,
  clearPending,
  clearSession,
  exchangeCode,
  isExpired,
  loadPending,
  loadSession,
  oidcErrorMessage,
  parseCallbackQuery,
  parseIdTokenClaims,
  refreshTokens,
  savePending,
  saveSession,
  sessionFromTokenResponse,
  type AuthSession,
} from "./oidc";
import { createPkcePair, randomToken } from "./pkce";

function userFromClaims(claims: ReturnType<typeof parseIdTokenClaims>): AuthUser {
  return {
    subject: claims.sub,
    name: claims.name,
    email: claims.email,
    username: claims.preferred_username,
    roles: claims.realm_access?.roles ?? [],
  };
}

function userFromSession(session: AuthSession): AuthUser | null {
  if (!session.idToken) return null;
  try {
    return userFromClaims(parseIdTokenClaims(session.idToken, { issuer: oauthConfig.issuer }));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  /** Persist a new session and switch to the authenticated state. */
  const applySession = useCallback((next: AuthSession) => {
    saveSession(next);
    setSession(next);
    setUser(userFromSession(next));
    setError(null);
    setStatus("authenticated");
  }, []);

  const goAnonymous = useCallback((message: string | null) => {
    clearSession();
    setSession(null);
    setUser(null);
    setError(message);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const completeLogin = async () => {
      try {
        const callbackError = oidcErrorMessage(window.location.search);
        if (callbackError) {
          clearPending();
          cleanCallbackUrl();
          goAnonymous(callbackError);
          return;
        }

        const callback = parseCallbackQuery(window.location.search);
        if (callback) {
          const pending = loadPending();
          if (!pending || pending.state !== callback.state) {
            cleanCallbackUrl();
            goAnonymous("Login session expired — please sign in again.");
            return;
          }
          const tokens = await exchangeCode(oauthConfig, {
            code: callback.code,
            codeVerifier: pending.codeVerifier,
          });
          const next = sessionFromTokenResponse(tokens);
          if (next.idToken) {
            parseIdTokenClaims(next.idToken, {
              issuer: oauthConfig.issuer,
              nonce: pending.nonce,
            });
          }
          clearPending();
          cleanCallbackUrl();
          applySession(next);
          return;
        }

        const stored = loadSession();
        if (!stored) {
          setStatus("anonymous");
          return;
        }
        if (!isExpired(stored)) {
          applySession(stored);
          return;
        }
        if (stored.refreshToken) {
          try {
            const tokens = await refreshTokens(oauthConfig, stored.refreshToken);
            applySession(sessionFromTokenResponse(tokens, stored.refreshToken));
            return;
          } catch {
            // Refresh failed: fall through to anonymous.
          }
        }
        goAnonymous("Your session expired — please sign in again.");
      } catch (cause) {
        clearPending();
        cleanCallbackUrl();
        goAnonymous(cause instanceof Error ? cause.message : "Login failed.");
      }
    };

    void completeLogin();
  }, [applySession, goAnonymous]);

  const login = useCallback(() => {
    void (async () => {
      try {
        const pkce = await createPkcePair();
        const state = randomToken();
        const nonce = randomToken();
        savePending({ state, nonce, codeVerifier: pkce.verifier, startedAt: Date.now() });
        window.location.assign(
          buildAuthorizeUrl(oauthConfig, { state, nonce, codeChallenge: pkce.challenge }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Login failed.");
      }
    })();
  }, []);

  const logout = useCallback(() => {
    const idToken = session?.idToken;
    clearPending();
    goAnonymous(null);
    if (idToken) {
      window.location.assign(buildLogoutUrl(oauthConfig, { idToken }));
    }
  }, [goAnonymous, session?.idToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      accessToken: session?.accessToken ?? null,
      error,
      login,
      logout,
    }),
    [status, user, session?.accessToken, error, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
