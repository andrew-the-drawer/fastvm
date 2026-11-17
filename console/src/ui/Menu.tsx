import { Menu as HMenu, MenuButton, MenuItem, MenuItems, MenuSeparator } from "@headlessui/react";
import { CheckIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface MenuAction {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  active?: boolean;
  separatorBefore?: boolean;
}

export interface DropdownMenuProps {
  label: string;
  trigger: ReactNode;
  items: readonly MenuAction[];
  header?: ReactNode;
  footer?: ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
  menuClassName?: string;
}

/** HyperUI-style dropdown menu on Headless UI. */
export function DropdownMenu({
  label,
  trigger,
  items,
  header,
  footer,
  align = "right",
  triggerClassName,
  menuClassName,
}: DropdownMenuProps) {
  return (
    <HMenu as="div" className="relative inline-flex text-left">
      <MenuButton aria-label={label} className={triggerClassName}>
        {trigger}
      </MenuButton>
      <MenuItems
        anchor={align === "right" ? "bottom end" : "bottom start"}
        className={cn(
          "z-50 mt-2 w-60 rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-lg focus:outline-none dark:border-gray-800 dark:bg-gray-900",
          menuClassName,
        )}
      >
        {header !== undefined ? (
          <div className="border-b border-gray-100 px-3 py-2.5 dark:border-gray-800">{header}</div>
        ) : null}
        {items.map((item) => (
          <div key={item.key}>
            {item.separatorBefore === true ? (
              <MenuSeparator className="my-2 h-px bg-gray-100 dark:bg-gray-800" />
            ) : null}
            <MenuItem disabled={item.disabled}>
              {({ focus }) => (
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={item.onClick}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md bg-transparent px-3 py-2 text-left text-sm font-medium transition-colors",
                    focus
                      ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                      : "text-gray-700 dark:text-gray-200",
                    item.danger === true && "text-red-600 dark:text-red-400",
                    item.disabled === true && "cursor-not-allowed opacity-50",
                  )}
                >
                  {item.icon !== undefined ? (
                    <span className="size-4 shrink-0">{item.icon}</span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.hint !== undefined ? (
                      <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                        {item.hint}
                      </span>
                    ) : null}
                  </span>
                  {item.active === true ? (
                    <CheckIcon
                      className="size-4 text-indigo-600 dark:text-indigo-400"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              )}
            </MenuItem>
          </div>
        ))}
        {footer !== undefined ? (
          <div className="border-t border-gray-100 px-3 py-2.5 dark:border-gray-800">{footer}</div>
        ) : null}
      </MenuItems>
    </HMenu>
  );
}
