import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { ToastContext } from "./toast-context";
import type { ToastApi } from "./toast-context";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const icons = {
  success: <CheckCircleIcon className="size-5 text-green-600 dark:text-green-400" />,
  error: <ExclamationTriangleIcon className="size-5 text-red-600 dark:text-red-400" />,
  info: <InformationCircleIcon className="size-5 text-indigo-600 dark:text-indigo-400" />,
} as const;

/** Minimal toast viewport; HyperUI-style card stack. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { id, kind, message }]);
      window.setTimeout(() => remove(id), 4200);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-white p-4 text-sm text-gray-900 shadow-lg dark:bg-gray-900 dark:text-gray-100",
              toast.kind === "error"
                ? "border-red-200 dark:border-red-900"
                : "border-gray-200 dark:border-gray-800",
            )}
          >
            <span className="mt-0.5 shrink-0">{icons[toast.kind]}</span>
            <span className="min-w-0 flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => remove(toast.id)}
              className="text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
