import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { IconButton } from "./Button";

const widths = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof widths;
  className?: string;
}

/** HyperUI-style centered dialog on an accessible Headless UI Dialog. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: ModalProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-gray-900/50" />
      <div className="fixed inset-0 flex items-end justify-center p-4 sm:items-center">
        <DialogPanel
          className={cn(
            "flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900",
            widths[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 p-6 pb-0">
            <div className="min-w-0">
              <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
                {title}
              </DialogTitle>
              {description !== undefined ? (
                <p className="mt-1 text-pretty text-sm text-gray-600 dark:text-gray-400">
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton label="Close dialog" onClick={onClose} className="-mr-2 -mt-2 shrink-0">
              <XMarkIcon className="size-5" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
          {footer !== undefined ? (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
              {footer}
            </div>
          ) : null}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
