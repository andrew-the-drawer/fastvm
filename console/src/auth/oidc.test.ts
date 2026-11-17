// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OAuthConfig } from "../lib/config";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  clearSession,
  decodeJwtPayload,
  exchangeCode,
  isExpired,
  loadPending,
  loadSession,
  OidcError,
  oidcErrorMessage,
  parseCallbackQuery,
  parseIdTokenClaims,
  refreshTokens,
  savePending,
  saveSession,
  sessionFromTokenResponse,
} from "./oidc";
import { base64UrlEncode } from "./pkce";

const config: OAuthConfig = {
  url: "http://localhost:8081",
  realm: "fastvm",
  clientId: "fastvm-console",
  scope: "openid profile email",
  issuer: "http://localhost:8081/realms/fastvm",
  authorizeEndpoint: "http://localhost:8081/realms/fastvm/protocol/openid-connect/auth",
  tokenEndpoint: "http://localhost:8081/realms/fastvm/protocol/openid-connect/token",
  logoutEndpoint: "http://localhost:8081/realms/fastvm/protocol/openid-connect/logout",
  redirectUri: "http://localhost:5173/",
};

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/** Build an unsigned JWT with the given payload. */
function unsignedJwt(payload: unknown): string {
  const encode = (value: unknown) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Extract the url-encoded form body from a mocked fetch call. */
function requestForm(init: RequestInit | undefined): URLSearchParams {
  if (typeof init?.body !== "string") {
    throw new Error("expected a url-encoded request body");
  }
  return new URLSearchParams(init.body);
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("sessionStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildAuthorizeUrl", () => {
  it("includes the authorization-code + PKCE parameters", () => {
    const url = new URL(
      buildAuthorizeUrl(config, {
        state: "state-1",
        nonce: "nonce-1",
        codeChallenge: "challenge-1",
      }),
    );
    expect(url.origin + url.pathname).toBe(config.authorizeEndpoint);
    expect(url.searchParams.get("client_id")).toBe("fastvm-console");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("exchangeCode", () => {
  it("posts the code and PKCE verifier to the token endpoint", async () => {
    const tokens = {
      access_token: "access-1",
      token_type: "Bearer",
      expires_in: 300,
      refresh_token: "refresh-1",
      id_token: unsignedJwt({ sub: "user-1" }),
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(tokens),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeCode(config, { code: "code-1", codeVerifier: "verifier-1" });
    expect(result.access_token).toBe("access-1");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [endpoint, init] = fetchMock.mock.calls[0]!;
    expect(endpoint).toBe(config.tokenEndpoint);
    const body = requestForm(init);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("fastvm-console");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("surfaces the provider's error_description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "invalid_grant", error_description: "Code is expired or invalid." },
          400,
        ),
      ),
    );
    await expect(exchangeCode(config, { code: "bad", codeVerifier: "v" })).rejects.toThrow(
      /Code is expired or invalid/,
    );
  });

  it("rejects non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 500 })),
    );
    await expect(exchangeCode(config, { code: "c", codeVerifier: "v" })).rejects.toBeInstanceOf(
      OidcError,
    );
  });

  it("rejects responses missing required token fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ token_type: "Bearer" })),
    );
    await expect(exchangeCode(config, { code: "c", codeVerifier: "v" })).rejects.toThrow(
      /Invalid token response/,
    );
  });
});

describe("refreshTokens", () => {
  it("posts a refresh_token grant", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ access_token: "access-2", token_type: "Bearer", expires_in: 300 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshTokens(config, "refresh-1");
    expect(result.access_token).toBe("access-2");
    const [, init] = fetchMock.mock.calls[0]!;
    const body = requestForm(init);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe("fastvm-console");
  });
});

describe("ID token parsing", () => {
  const claims = {
    sub: "861db7e9",
    name: "Demo User",
    email: "demo@fastvm.local",
    preferred_username: "demo",
    realm_access: { roles: ["fastvm-admin", "offline_access"] },
    iss: config.issuer,
    nonce: "nonce-1",
  };

  it("decodes the payload", () => {
    expect(decodeJwtPayload(unsignedJwt(claims))).toMatchObject({ sub: "861db7e9" });
  });

  it("validates claims and enforces issuer/nonce", () => {
    const parsed = parseIdTokenClaims(unsignedJwt(claims), {
      issuer: config.issuer,
      nonce: "nonce-1",
    });
    expect(parsed.preferred_username).toBe("demo");
    expect(parsed.realm_access?.roles).toContain("fastvm-admin");

    expect(() => parseIdTokenClaims(unsignedJwt(claims), { issuer: "http://evil" })).toThrow(
      /issuer mismatch/,
    );
    expect(() => parseIdTokenClaims(unsignedJwt(claims), { nonce: "other" })).toThrow(
      /nonce mismatch/,
    );
  });

  it("rejects malformed tokens", () => {
    expect(() => decodeJwtPayload("not-a-jwt")).toThrow(/Malformed JWT/);
    expect(() => parseIdTokenClaims(unsignedJwt({}) as string)).toThrow(/Invalid ID token claims/);
  });
});

describe("session handling", () => {
  it("converts token responses and keeps the previous refresh token", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const session = sessionFromTokenResponse(
      { access_token: "a", token_type: "Bearer", expires_in: 300, id_token: "id" },
      "previous-refresh",
    );
    expect(session.expiresAt).toBe(1_000_000 + 300_000);
    expect(session.refreshToken).toBe("previous-refresh");
    expect(isExpired(session, 1_000_000)).toBe(false);
    expect(isExpired(session, 1_000_000 + 300_000)).toBe(true);
  });

  it("round-trips the session through sessionStorage", () => {
    const session = { accessToken: "a", idToken: "id", expiresAt: 123 };
    saveSession(session);
    expect(loadSession()).toEqual(session);
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it("ignores corrupted stored sessions", () => {
    storage.setItem("fastvm.console.session.v1", "{not json");
    expect(loadSession()).toBeNull();
  });

  it("expires stale pending authorizations", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    savePending({
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      startedAt: 1_000_000,
    });
    expect(loadPending()?.state).toBe("s");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 11 * 60 * 1000);
    expect(loadPending()).toBeNull();
  });
});

describe("callback helpers", () => {
  it("parses code/state and errors from the query string", () => {
    expect(parseCallbackQuery("?code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz" });
    expect(parseCallbackQuery("?state=xyz")).toBeNull();
    expect(oidcErrorMessage("?error=access_denied&error_description=Nope")).toBe("Nope");
    expect(oidcErrorMessage("?code=abc")).toBeNull();
  });

  it("builds an RP-initiated logout URL", () => {
    const url = new URL(buildLogoutUrl(config, { idToken: "id-token" }));
    expect(url.origin + url.pathname).toBe(config.logoutEndpoint);
    expect(url.searchParams.get("client_id")).toBe("fastvm-console");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("id_token_hint")).toBe("id-token");

    const withoutHint = new URL(buildLogoutUrl(config));
    expect(withoutHint.searchParams.has("id_token_hint")).toBe(false);
  });
});
