import { useTheme } from "../theme/theme-mode";
import type { ThemeMode } from "../theme/theme-mode";
import { DropdownMenu } from "../ui";
import type { MenuAction } from "../ui";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

interface ThemeOption {
  readonly mode: ThemeMode;
  readonly label: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { mode: "dark", label: "Dark" },
  { mode: "light", label: "Light" },
  { mode: "auto", label: "Auto (system)" },
];

function optionLabel(mode: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.mode === mode)?.label ?? "Auto (system)";
}

function ThemeModeIcon({
  mode,
  resolvedMode,
  className,
}: {
  mode: ThemeMode;
  resolvedMode: "dark" | "light";
  className?: string;
}) {
  if (mode === "auto") {
    return <MonitorIcon className={className} />;
  }
  return resolvedMode === "dark" ? (
    <MoonIcon className={className} />
  ) : (
    <SunIcon className={className} />
  );
}

/**
 * Theme switcher: a sidebar icon button opening a dropdown menu with the three
 * theme modes. Selection applies immediately, persists and closes the menu;
 * the active mode is marked with a check icon.
 */
export function ThemeMenu() {
  const { mode, resolvedMode, setMode } = useTheme();
  const title =
    mode === "auto" ? `Theme: Auto (currently ${resolvedMode})` : `Theme: ${optionLabel(mode)}`;

  const items: MenuAction[] = THEME_OPTIONS.map((option) => ({
    key: option.mode,
    label: option.label,
    icon: <ThemeModeIcon mode={option.mode} resolvedMode={resolvedMode} className="size-4" />,
    active: mode === option.mode,
    onClick: () => setMode(option.mode),
  }));

  return (
    <DropdownMenu
      label="Theme"
      trigger={
        <span title={title}>
          <ThemeModeIcon mode={mode} resolvedMode={resolvedMode} className="size-5" />
        </span>
      }
      triggerClassName="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-4 focus-visible:ring-indigo-200 focus-visible:outline-none dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white dark:focus-visible:ring-indigo-900"
      items={items}
    />
  );
}

export default ThemeMenu;
