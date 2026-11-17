import { Switch as HSwitch } from "@headlessui/react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 dark:disabled:bg-gray-800";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required === true ? <span className="text-red-600"> *</span> : null}
      </label>
      {children}
      {error !== undefined && error !== null && error !== false ? (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : hint !== undefined && hint !== null ? (
        <span className="text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-9", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-20", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const switchButton = (
    <HSwitch
      id={id}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200 disabled:opacity-50 dark:focus-visible:ring-indigo-900",
        checked ? "bg-indigo-600" : "bg-gray-200 dark:bg-gray-700",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </HSwitch>
  );
  if (label === undefined) {
    return switchButton;
  }
  return (
    <div className="flex items-start gap-3">
      {switchButton}
      <div className="flex flex-col">
        <label
          htmlFor={id}
          className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
        </label>
        {description !== undefined ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">{description}</span>
        ) : null}
      </div>
    </div>
  );
}
