import { Menu } from "@base-ui/react/menu";
import { parseThemeMode, useTheme } from "../theme/theme-mode";
import type { ThemeMode } from "../theme/theme-mode";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "./icons";

interface ThemeOption {
  readonly mode: ThemeMode;
  readonly label: string;
  readonly description: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { mode: "dark", label: "Dark", description: "Always use the dark theme" },
  { mode: "light", label: "Light", description: "Always use the light theme" },
  { mode: "auto", label: "Auto (system)", description: "Follow the operating system appearance" },
];

function optionLabel(mode: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.mode === mode)?.label ?? "Auto (system)";
}

function ThemeModeIcon({
  mode,
  resolvedMode,
}: {
  mode: ThemeMode;
  resolvedMode: "dark" | "light";
}) {
  if (mode === "auto") {
    return <MonitorIcon />;
  }
  return resolvedMode === "dark" ? <MoonIcon /> : <SunIcon />;
}

/**
 * Theme switcher: a header icon button opening a Base UI menu with three radio
 * options. Selection applies immediately, persists and closes the menu.
 */
export function ThemeMenu() {
  const { mode, resolvedMode, setMode } = useTheme();
  const title =
    mode === "auto" ? `Theme: Auto (currently ${resolvedMode})` : `Theme: ${optionLabel(mode)}`;

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        render={
          <button
            type="button"
            className="icon-button theme-trigger"
            aria-label="Theme"
            title={title}
          />
        }
      >
        <ThemeModeIcon mode={mode} resolvedMode={resolvedMode} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="menu-positioner">
          <Menu.Popup className="vm-menu-popup theme-menu-popup">
            <Menu.RadioGroup
              value={mode}
              onValueChange={(value: unknown) => {
                setMode(typeof value === "string" ? parseThemeMode(value) : "auto");
              }}
            >
              <Menu.GroupLabel className="theme-menu-heading">Theme</Menu.GroupLabel>
              {THEME_OPTIONS.map((option) => (
                <Menu.RadioItem
                  key={option.mode}
                  value={option.mode}
                  label={option.label}
                  className="vm-menu-item theme-menu-item"
                  closeOnClick
                  title={option.description}
                >
                  <ThemeModeIcon mode={option.mode} resolvedMode={resolvedMode} />
                  <span className="theme-menu-item-label">{option.label}</span>
                  <Menu.RadioItemIndicator className="theme-menu-check">
                    <CheckIcon />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export default ThemeMenu;
