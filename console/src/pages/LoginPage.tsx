import { Alert, Button, Card, Tag } from "antd";
import { useState } from "react";
import { useAuth } from "../auth/context";
import { ActivityIcon, BoltIcon, LayersIcon, ShieldCheckIcon, ZapIcon } from "../components/icons";

/** Unauthenticated landing screen: split hero + Keycloak sign-in card. */
export default function LoginPage() {
  const auth = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = () => {
    setSigningIn(true);
    auth.login();
  };

  return (
    <main className="login-page">
      <div className="login-glow" aria-hidden="true" />

      <div className="login-shell">
        <section className="login-hero" aria-label="About fastvm">
          <div className="brand brand--login">
            <span className="brand-mark" aria-hidden="true">
              <BoltIcon />
            </span>
            <span className="brand-name">
              fastvm <span className="brand-name-sub">console</span>
            </span>
          </div>

          <h1 className="login-headline">Micro-VMs that sleep until the first packet.</h1>
          <p className="login-pitch">
            Firecracker sandboxes that pause in milliseconds, offload their memory, and wake on
            inbound traffic. This console gives you the live view and the lifecycle controls.
          </p>

          <ul className="login-features">
            <li className="login-feature">
              <span className="login-feature-icon">
                <ZapIcon />
              </span>
              <div>
                <span className="login-feature-title">Wake on traffic</span>
                <span className="login-feature-copy">
                  Paused and dormant VMs buffer frames and resume on the first packet.
                </span>
              </div>
            </li>
            <li className="login-feature">
              <span className="login-feature-icon">
                <ActivityIcon />
              </span>
              <div>
                <span className="login-feature-title">Live utilization</span>
                <span className="login-feature-copy">
                  Per-sandbox CPU, memory, uptime and block/network counters, refreshed every 2s.
                </span>
              </div>
            </li>
            <li className="login-feature">
              <span className="login-feature-icon">
                <LayersIcon />
              </span>
              <div>
                <span className="login-feature-title">Copy-on-write images</span>
                <span className="login-feature-copy">
                  Boot from content-addressed base disks with a disposable writable volume.
                </span>
              </div>
            </li>
          </ul>

          <p className="login-hero-foot">
            Same-origin <code>/v1</code> API · OIDC via Keycloak
          </p>
        </section>

        <section className="login-card-wrap" aria-label="Sign in">
          <Card className="login-card">
            <div className="login-card-head">
              <span className="login-card-icon" aria-hidden="true">
                <ShieldCheckIcon />
              </span>
              <h2 className="login-card-title">Sign in to your workspace</h2>
              <p className="login-card-copy">
                Continue with your Keycloak account. You will be redirected to the identity provider
                and brought straight back here.
              </p>
            </div>

            <Button
              type="primary"
              size="large"
              block
              className="login-button"
              loading={signingIn}
              onClick={handleSignIn}
            >
              {signingIn ? "Redirecting to Keycloak…" : "Sign in with Keycloak"}
            </Button>

            {auth.error !== null && auth.error !== "" ? (
              <Alert
                className="login-error"
                type="error"
                showIcon
                title="Sign-in failed"
                description={auth.error}
              />
            ) : null}

            <p className="login-status" role="status">
              <span
                className={
                  signingIn ? "login-status-dot login-status-dot--busy" : "login-status-dot"
                }
              />
              {signingIn
                ? "Contacting the identity provider…"
                : "Single sign-on · no password is stored in this console"}
            </p>

            <div className="login-card-foot">
              <Tag className="login-tag">OIDC</Tag>
              <Tag className="login-tag">PKCE</Tag>
              <span className="login-card-foot-copy">fastvmd control plane</span>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
