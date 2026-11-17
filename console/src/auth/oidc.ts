/**
 * OIDC authorization-code + PKCE flows against Keycloak.
 *
 * This module is intentionally framework-free: it builds URLs, exchanges codes,
 * validates responses with zod, and persists the short-lived session in
 * `sessionStorage`. `AuthProvider` owns the React wiring.
 */
import { z } from "zod";
import type { OAuthConfig } from "../lib/config";

/** Error raised when the OIDC provider returns something unusable. */
export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcError";
  }
}

const errorResponseSchema = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .passthrough();

/** Successful token endpoint response (fields the console uses). */
export const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
    refresh_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    scope: z.string().optional(),
  })
  .passthrough();
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** Claims decoded from the ID token (no signature verification is needed here:
 * the token came straight from the token endpoint over TLS). */
export const idTokenClaimsSchema = z
  .object({
    sub: z.string().min(1),
    name: z.string().optional(),
    email: z.string().optional(),
    preferred_username: z.string().optional(),
    realm_access: z
      .object({ roles: z.array(z.string()) })
      .passthrough()
      .optional(),
    exp: z.number().optional(),
    nonce: z.string().optional(),
    iss: z.string().optional(),
  })
  .passthrough();
export type IdTokenClaims = z.infer<typeof idTokenClaimsSchema>;

/** Parameters needed to build the authorization redirect. */
export interface AuthorizeParams {
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

/** Build the Keycloak authorization URL for the authorization-code + PKCE flow. */
export function buildAuthorizeUrl(config: OAuthConfig, params: AuthorizeParams): string {
  const url = new URL(config.authorizeEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function requestToken(
  config: OAuthConfig,
  form: Record<string, string>,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (error) {
    throw new OidcError(
      `Cannot reach the identity provider at ${config.tokenEndpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OidcError(
      `Identity provider returned a non-JSON response (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    const oidcError = errorResponseSchema.safeParse(body);
    if (oidcError.success) {
      const description = oidcError.data.error_description ?? oidcError.data.error;
      throw new OidcError(`Identity provider rejected the request: ${description}`);
    }
    throw new OidcError(`Identity provider returned HTTP ${response.status}.`);
  }

  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new OidcError(`Invalid token response: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Exchange an authorization code (with its PKCE verifier) for tokens. */
export function exchangeCode(
  config: OAuthConfig,
  params: { readonly code: string; readonly codeVerifier: string },
): Promise<TokenResponse> {
  return requestToken(config, {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: params.code,
    redirect_uri: config.redirectUri,
    code_verifier: params.codeVerifier,
  });
}

/** Refresh an access token with a refresh token. */
export function refreshTokens(config: OAuthConfig, refreshToken: string): Promise<TokenResponse> {
  return requestToken(config, {
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
}

/** Decode the payload of a JWT without verifying its signature. */
export function decodeJwtPayload(token: string): unknown {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new OidcError("Malformed JWT: expected three dot-separated segments.");
  }
  const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new OidcError("Malformed JWT: payload is not JSON.");
  }
}

/** Decode and validate ID-token claims, optionally enforcing issuer/nonce. */
export function parseIdTokenClaims(
  idToken: string,
  options: { readonly issuer?: string; readonly nonce?: string } = {},
): IdTokenClaims {
  const parsed = idTokenClaimsSchema.safeParse(decodeJwtPayload(idToken));
  if (!parsed.success) {
    throw new OidcError(`Invalid ID token claims: ${z.prettifyError(parsed.error)}`);
  }
  if (options.issuer && parsed.data.iss && parsed.data.iss !== options.issuer) {
    throw new OidcError(
      `ID token issuer mismatch: expected ${options.issuer}, got ${parsed.data.iss}.`,
    );
  }
  if (options.nonce && parsed.data.nonce && parsed.data.nonce !== options.nonce) {
    throw new OidcError("ID token nonce mismatch.");
  }
  return parsed.data;
}

/** A console session persisted in sessionStorage (cleared when the tab closes). */
export interface AuthSession {
  readonly accessToken: string;
  readonly idToken?: string;
  readonly refreshToken?: string;
  /** Expiry of the access token, epoch milliseconds. */
  readonly expiresAt: number;
}

const sessionSchema = z.object({
  accessToken: z.string().min(1),
  idToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().finite(),
});

/** Convert a token response into a session, keeping a previous refresh token. */
export function sessionFromTokenResponse(
  tokens: TokenResponse,
  previousRefreshToken?: string,
): AuthSession {
  const lifetimeSeconds = tokens.expires_in ?? 300;
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token ?? previousRefreshToken,
    expiresAt: Date.now() + lifetimeSeconds * 1000,
  };
}

/** True when the access token is expired (or about to expire within `skewMs`). */
export function isExpired(
  session: AuthSession,
  now: number = Date.now(),
  skewMs = 30_000,
): boolean {
  return session.expiresAt - skewMs <= now;
}

const SESSION_KEY = "fastvm.console.session.v1";
const PENDING_KEY = "fastvm.console.pending.v1";
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** Save the session for the lifetime of the browser tab. */
export function saveSession(session: AuthSession): void {
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Load a previously saved session, if it is still valid JSON. */
export function loadSession(): AuthSession | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Remove any saved session. */
export function clearSession(): void {
  storage()?.removeItem(SESSION_KEY);
}

/** State persisted between the authorization redirect and the callback. */
export interface PendingAuth {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly startedAt: number;
}

/** Save the in-flight authorization request (state/nonce/PKCE verifier). */
export function savePending(pending: PendingAuth): void {
  storage()?.setItem(PENDING_KEY, JSON.stringify(pending));
}

/** Load the in-flight authorization request, ignoring stale entries. */
export function loadPending(): PendingAuth | null {
  const raw = storage()?.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = z
      .object({
        state: z.string().min(1),
        nonce: z.string().min(1),
        codeVerifier: z.string().min(1),
        startedAt: z.number().finite(),
      })
      .safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (Date.now() - parsed.data.startedAt > PENDING_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Remove the in-flight authorization request. */
export function clearPending(): void {
  storage()?.removeItem(PENDING_KEY);
}

/** Parse `?code=&state=` from the callback query string. */
export function parseCallbackQuery(search: string): { code: string; state: string } | null {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return null;
  return { code, state };
}

/** Extract a human-readable error from a failed authorization redirect. */
export function oidcErrorMessage(search: string): string | null {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (!error) return null;
  return params.get("error_description") ?? error;
}

/** Build the Keycloak end-session URL for RP-initiated logout. */
export function buildLogoutUrl(
  config: OAuthConfig,
  options: { readonly idToken?: string } = {},
): string {
  const url = new URL(config.logoutEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", config.redirectUri);
  if (options.idToken) {
    url.searchParams.set("id_token_hint", options.idToken);
  }
  return url.toString();
}

/** Strip OIDC parameters from the address bar after a callback. */
export function cleanCallbackUrl(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, document.title, window.location.pathname);
}
