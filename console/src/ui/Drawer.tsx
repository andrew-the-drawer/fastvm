import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { IconButton } from "./Button";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}

/** Right-side panel built on Headless UI Dialog, styled like a HyperUI card. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  widthClassName = "max-w-xl",
}: DrawerProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-gray-900/50" />
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full">
            <DialogPanel
              className={cn(
                "pointer-events-auto flex h-full w-screen flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900",
                widthClassName,
              )}
            >
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4 dark:border-gray-800">
                <div className="min-w-0">
                  <DialogTitle className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                    {title}
                  </DialogTitle>
                  {subtitle !== undefined ? (
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {subtitle}
                    </div>
                  ) : null}
                </div>
                <IconButton
                  label="Close details"
                  onClick={onClose}
                  className="-mr-2 -mt-1 shrink-0"
                >
                  <XMarkIcon className="size-5" />
                </IconButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
              {footer !== undefined ? (
                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
                  {footer}
                </div>
              ) : null}
            </DialogPanel>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
