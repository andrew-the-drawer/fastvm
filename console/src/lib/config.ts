import { z } from "zod";

/**
 * Runtime configuration for the console, read from Vite's `import.meta.env`.
 *
 * Only `VITE_*` variables are exposed to the browser. Defaults match the
 * Keycloak compose stack that ships with the repo (`console/compose.yaml`).
 */
export const appEnvSchema = z.object({
  VITE_KEYCLOAK_URL: z.url().default("http://localhost:8081"),
  VITE_KEYCLOAK_REALM: z.string().min(1).default("fastvm"),
  VITE_KEYCLOAK_CLIENT_ID: z.string().min(1).default("fastvm-console"),
  VITE_KEYCLOAK_SCOPE: z.string().min(1).default("openid profile email"),
});

export type AppConfig = z.infer<typeof appEnvSchema>;

/** Parse and validate the OIDC environment; throws on malformed values. */
export function parseAppConfig(env: Record<string, unknown>): AppConfig {
  const result = appEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid console environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Validated OIDC configuration for this build. */
export const appConfig: AppConfig = parseAppConfig(import.meta.env);

/** OIDC endpoints and values derived from {@link appConfig}. */
export interface OAuthConfig {
  /** Keycloak base URL without a trailing slash. */
  readonly url: string;
  readonly realm: string;
  readonly clientId: string;
  readonly scope: string;
  /** OIDC issuer URL (`${url}/realms/${realm}`). */
  readonly issuer: string;
  readonly authorizeEndpoint: string;
  readonly tokenEndpoint: string;
  readonly logoutEndpoint: string;
  /** Where Keycloak sends the browser back after login: the console origin. */
  readonly redirectUri: string;
}

function currentOrigin(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return "http://localhost:5173";
}

/** Derive Keycloak/OIDC endpoint URLs from a parsed environment. */
export function buildOAuthConfig(config: AppConfig): OAuthConfig {
  const url = config.VITE_KEYCLOAK_URL.replace(/\/+$/, "");
  const realm = config.VITE_KEYCLOAK_REALM;
  const issuer = `${url}/realms/${realm}`;
  return {
    url,
    realm,
    clientId: config.VITE_KEYCLOAK_CLIENT_ID,
    scope: config.VITE_KEYCLOAK_SCOPE,
    issuer,
    authorizeEndpoint: `${issuer}/protocol/openid-connect/auth`,
    tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
    logoutEndpoint: `${issuer}/protocol/openid-connect/logout`,
    redirectUri: `${currentOrigin()}/`,
  };
}

/** OIDC values consumed by the auth layer (authorize/token/logout URLs). */
export const oauthConfig: OAuthConfig = buildOAuthConfig(appConfig);
