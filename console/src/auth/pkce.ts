/**
 * PKCE (RFC 7636) and OIDC state helpers.
 *
 * Uses only Web Crypto so the console needs no auth library. Everything here is
 * pure and unit-testable; `AuthProvider` composes it into the login flow.
 */

/** Number of random bytes used for state/nonce/verifier values (256 bits). */
const RANDOM_BYTES = 32;

/** Encode bytes as unpadded base64url (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Cryptographically random, unpadded-base64url token. */
export function randomToken(bytes: number = RANDOM_BYTES): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

/** SHA-256 of `value`, encoded as unpadded base64url. */
export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

/** A PKCE verifier and its S256 challenge. */
export interface PkcePair {
  /** High-entropy secret kept in sessionStorage until the token exchange. */
  readonly verifier: string;
  /** SHA-256(verifier) sent to the authorization endpoint. */
  readonly challenge: string;
}

/** Create a fresh PKCE verifier/challenge pair (S256). */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomToken(RANDOM_BYTES);
  return { verifier, challenge: await sha256Base64Url(verifier) };
}

/** RFC 7636 §4.1 syntax check for a code verifier. */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}
