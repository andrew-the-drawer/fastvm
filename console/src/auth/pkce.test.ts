// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import {
  base64UrlEncode,
  createPkcePair,
  isValidCodeVerifier,
  randomToken,
  sha256Base64Url,
} from "./pkce";

describe("base64UrlEncode", () => {
  it("encodes bytes as unpadded base64url", () => {
    expect(base64UrlEncode(new Uint8Array([]))).toBe("");
    expect(base64UrlEncode(new Uint8Array([0x66]))).toBe("Zg");
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
});

describe("randomToken", () => {
  it("produces URL-safe, high-entropy values", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it("honours the requested byte length", () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("sha256Base64Url", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    // https://datatracker.ietf.org/doc/html/rfc7636#appendix-B
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    await expect(sha256Base64Url(verifier)).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("createPkcePair", () => {
  it("returns a valid verifier and its S256 challenge", async () => {
    const pair = await createPkcePair();
    expect(isValidCodeVerifier(pair.verifier)).toBe(true);
    await expect(sha256Base64Url(pair.verifier)).resolves.toBe(pair.challenge);
  });

  it("generates a fresh pair each time", async () => {
    const [first, second] = await Promise.all([createPkcePair(), createPkcePair()]);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("isValidCodeVerifier", () => {
  it("accepts RFC 7636 values and rejects short or illegal ones", () => {
    expect(isValidCodeVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(true);
    expect(isValidCodeVerifier("too-short")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43) + "!")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
  });
});
