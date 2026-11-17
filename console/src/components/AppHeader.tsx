import { useVersion } from "../lib/queries";
import { BoltIcon, RefreshIcon } from "./icons";
import { ThemeMenu } from "./ThemeMenu";
import { UserMenu } from "./UserMenu";

export interface AppHeaderProps {
  /** True while a manual refresh is in flight (background polling stays quiet). */
  isRefreshing: boolean;
  onRefresh: () => void;
}

function versionLabel(version: { version: string; name?: string } | undefined): string {
  if (!version) {
    return "fastvmd";
  }
  return version.name !== undefined && version.name !== ""
    ? `${version.name} v${version.version}`
    : `fastvmd v${version.version}`;
}

/** Sticky top bar: brand, daemon version, auto-refresh controls and account menu. */
export function AppHeader({ isRefreshing, onRefresh }: AppHeaderProps) {
  const version = useVersion();
  const versionText = version.isPending
    ? "fastvmd …"
    : version.isError
      ? "fastvmd offline"
      : versionLabel(version.data);

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <BoltIcon />
        </span>
        <span className="brand-name">
          fastvm <span className="brand-name-sub">console</span>
        </span>
      </div>

      <div className="app-header-right">
        <span
          className={
            version.isError === true
              ? "version-tag version-tag--error"
              : "version-tag version-tag--ok"
          }
          title={
            version.isError
              ? "fastvmd is unreachable; lifecycle data cannot be loaded."
              : "Connected to fastvmd over the same-origin API."
          }
        >
          <span className="version-dot" aria-hidden="true" />
          {versionText}
        </span>

        <span className="live-hint" title="Sandboxes refresh every 3s, stats every 2s.">
          <span className="live-dot" aria-hidden="true" />
          Auto-refresh
        </span>

        <button
          type="button"
          className="icon-button"
          aria-label="Refresh sandboxes"
          onClick={onRefresh}
        >
          <RefreshIcon className={isRefreshing ? "spinning" : undefined} />
        </button>

        <span className="header-divider" aria-hidden="true" />

        <ThemeMenu />

        <UserMenu />
      </div>
    </header>
  );
}

export default AppHeader;
