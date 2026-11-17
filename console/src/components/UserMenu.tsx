import { Menu } from "@base-ui/react/menu";
import { Avatar, Tag } from "antd";
import { useAuth } from "../auth/context";
import { ChevronDownIcon, LogoutIcon } from "./icons";

function initialsFor(name: string): string {
  const parts = name
    .split(/[\s._@-]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/** Account chip with a Base UI menu (identity, roles, sign out). */
export function UserMenu() {
  const auth = useAuth();
  const user = auth.user;
  const displayName =
    user?.name ??
    user?.username ??
    user?.email ??
    user?.subject ??
    (auth.status === "anonymous" ? "Not signed in" : "Unknown user");
  const roles = user?.roles ?? [];

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        render={<button type="button" className="user-menu-trigger" aria-label="Account menu" />}
      >
        <Avatar size={30} className="user-avatar">
          {initialsFor(displayName)}
        </Avatar>
        <span className="user-menu-name">{displayName}</span>
        <ChevronDownIcon className="user-menu-caret" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="menu-positioner">
          <Menu.Popup className="vm-menu-popup user-menu-popup">
            <div className="user-menu-head" role="presentation">
              <span className="user-menu-head-name">{displayName}</span>
              {user?.email !== undefined ? (
                <span className="user-menu-head-email">{user.email}</span>
              ) : null}
              {roles.length > 0 ? (
                <div className="user-menu-roles">
                  {roles.map((role) => (
                    <Tag key={role} className="user-role-tag">
                      {role}
                    </Tag>
                  ))}
                </div>
              ) : (
                <span className="user-menu-head-email">No roles in token</span>
              )}
            </div>
            <Menu.Separator className="vm-menu-separator" />
            <Menu.Item className="vm-menu-item" onClick={auth.logout}>
              <LogoutIcon />
              <span>Sign out</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export default UserMenu;
