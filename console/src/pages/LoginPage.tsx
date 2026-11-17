import { ExclamationTriangleIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useAuth } from "../auth/context";
import { BoltIcon } from "../components/icons";
import { Button } from "../ui";

/**
 * Unauthenticated landing screen. Deliberately minimal: a single centered
 * sign-in card (no marketing columns or feature pitch) so it reads the same on
 * narrow and very wide screens.
 */
export default function LoginPage() {
  const auth = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = () => {
    setSigningIn(true);
    auth.login();
  };

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-2 dark:bg-gray-950">
      <section
        className="flex min-h-screen flex-col justify-center bg-white px-6 py-12 sm:px-10 lg:px-16 dark:bg-gray-950"
        aria-label="Sign in"
      >
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <BoltIcon className="size-5" />
            </span>
            <span className="text-lg font-semibold text-gray-900 dark:text-white">
              fastvm <span className="font-normal text-gray-500 dark:text-gray-400">console</span>
            </span>
          </div>

          <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Welcome back</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Sign in with SSO to continue.
          </p>

          <Button
            variant="primary"
            size="md"
            className="mt-6 w-full"
            icon={<LockClosedIcon className="size-4" aria-hidden="true" />}
            loading={signingIn}
            onClick={handleSignIn}
          >
            {signingIn ? "Redirecting…" : "Sign in with SSO"}
          </Button>

          {auth.error !== null && auth.error !== "" ? (
            <div
              className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              role="alert"
            >
              <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">Sign-in failed</p>
                <p className="mt-0.5 break-words">{auth.error}</p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className="relative hidden overflow-hidden bg-indigo-700 px-10 py-16 lg:flex lg:flex-col lg:justify-between lg:px-16 dark:bg-indigo-800"
        aria-label="Introduction"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 -right-24 size-80 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-20 size-72 rounded-full bg-indigo-400/20 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5 text-white">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/20">
            <BoltIcon className="size-5" />
          </span>
          <span className="text-lg font-semibold">
            fastvm <span className="font-normal text-indigo-200">console</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Your sandboxes, one console.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-indigo-100">
            Manage sandboxes, images, and terminal sessions from a single place.
          </p>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-indigo-200">
          <span className="size-1.5 rounded-full bg-green-300" aria-hidden="true" />
          fastvm control plane
        </div>
      </section>
    </main>
  );
}
