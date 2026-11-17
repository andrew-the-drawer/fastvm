import { describe, expect, it } from "vite-plus/test";
import { appConfig, buildOAuthConfig, oauthConfig, parseAppConfig } from "./config";

describe("parseAppConfig", () => {
  it("falls back to the local Keycloak compose defaults", () => {
    expect(parseAppConfig({})).toEqual({
      VITE_KEYCLOAK_URL: "http://localhost:8081",
      VITE_KEYCLOAK_REALM: "fastvm",
      VITE_KEYCLOAK_CLIENT_ID: "fastvm-console",
      VITE_KEYCLOAK_SCOPE: "openid profile email",
    });
  });

  it("accepts overrides", () => {
    expect(
      parseAppConfig({
        VITE_KEYCLOAK_URL: "https://id.example.com",
        VITE_KEYCLOAK_REALM: "prod",
        VITE_KEYCLOAK_CLIENT_ID: "console",
        VITE_KEYCLOAK_SCOPE: "openid",
      }),
    ).toEqual({
      VITE_KEYCLOAK_URL: "https://id.example.com",
      VITE_KEYCLOAK_REALM: "prod",
      VITE_KEYCLOAK_CLIENT_ID: "console",
      VITE_KEYCLOAK_SCOPE: "openid",
    });
  });

  it("rejects a malformed Keycloak URL", () => {
    expect(() => parseAppConfig({ VITE_KEYCLOAK_URL: "not-a-url" })).toThrow(
      /Invalid console environment/,
    );
  });

  it("rejects empty realm/client/scope values", () => {
    expect(() => parseAppConfig({ VITE_KEYCLOAK_REALM: "" })).toThrow(
      /Invalid console environment/,
    );
  });
});

describe("buildOAuthConfig", () => {
  it("derives Keycloak endpoints from the base URL and realm", () => {
    const config = buildOAuthConfig(
      parseAppConfig({
        VITE_KEYCLOAK_URL: "https://id.example.com/",
        VITE_KEYCLOAK_REALM: "fastvm",
        VITE_KEYCLOAK_CLIENT_ID: "fastvm-console",
        VITE_KEYCLOAK_SCOPE: "openid profile email",
      }),
    );

    expect(config.url).toBe("https://id.example.com");
    expect(config.issuer).toBe("https://id.example.com/realms/fastvm");
    expect(config.authorizeEndpoint).toBe(
      "https://id.example.com/realms/fastvm/protocol/openid-connect/auth",
    );
    expect(config.tokenEndpoint).toBe(
      "https://id.example.com/realms/fastvm/protocol/openid-connect/token",
    );
    expect(config.logoutEndpoint).toBe(
      "https://id.example.com/realms/fastvm/protocol/openid-connect/logout",
    );
    expect(config.clientId).toBe("fastvm-console");
    expect(config.scope).toBe("openid profile email");
    expect(config.redirectUri.endsWith("/")).toBe(true);
  });
});

describe("appConfig", () => {
  it("is populated from the current Vite environment", () => {
    expect(appConfig.VITE_KEYCLOAK_URL).toBe("http://localhost:8081");
    expect(oauthConfig.realm).toBe("fastvm");
    expect(oauthConfig.clientId).toBe("fastvm-console");
    expect(oauthConfig.authorizeEndpoint).toBe(
      "http://localhost:8081/realms/fastvm/protocol/openid-connect/auth",
    );
  });
});
