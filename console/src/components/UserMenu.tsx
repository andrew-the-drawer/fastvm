import { useMemo } from "react";
import { useAuth } from "../auth/context";
import { avatarDataUri } from "../lib/avatar";
import { DropdownMenu } from "../ui";
import type { MenuAction } from "../ui";
import { ChevronDownIcon, LogoutIcon } from "./icons";

/** Sidebar account chip opening a dropdown menu with identity, roles and sign out. */
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
  const avatarSeed = user?.email ?? user?.username ?? user?.subject ?? displayName;
  const avatar = useMemo(() => avatarDataUri(avatarSeed), [avatarSeed]);

  const items: MenuAction[] = [
    {
      key: "sign-out",
      label: "Sign out",
      icon: <LogoutIcon className="size-4" />,
      onClick: auth.logout,
      separatorBefore: true,
    },
  ];

  return (
    <DropdownMenu
      label="Account menu"
      trigger={
        <>
          <img
            src={avatar}
            alt={`${displayName} avatar`}
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-full bg-indigo-50 object-cover ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
            {displayName}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-gray-400" />
        </>
      }
      triggerClassName="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-gray-100 focus-visible:ring-4 focus-visible:ring-indigo-200 focus-visible:outline-none dark:hover:bg-gray-800 dark:focus-visible:ring-indigo-900"
      items={items}
      header={
        <div className="flex flex-col gap-1" role="presentation">
          <span className="text-sm font-medium text-gray-900 dark:text-white">{displayName}</span>
          {user?.email !== undefined ? (
            <span className="break-words text-xs text-gray-500 dark:text-gray-400">
              {user.email}
            </span>
          ) : null}
          {roles.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {roles.map((role) => (
                <span
                  key={role}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                >
                  {role}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">No roles in token</span>
          )}
        </div>
      }
    />
  );
}

export default UserMenu;
