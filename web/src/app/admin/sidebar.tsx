"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GridIcon, UsersIcon, LogOutIcon } from "./icons";

type NavItem = { href: string; label: string; icon: typeof GridIcon };
type NavSection = { label: string; items: NavItem[] };

export function Sidebar({
  email,
  showUsers,
  signOutAction,
}: {
  email: string | null;
  showUsers: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();

  const sections: NavSection[] = [
    {
      label: "Operations",
      items: [{ href: "/admin/masterdata", label: "Master Data", icon: GridIcon }],
    },
    ...(showUsers
      ? [
          {
            label: "Setup",
            items: [{ href: "/admin/users", label: "Users", icon: UsersIcon }],
          },
        ]
      : []),
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-text">
      <div className="px-5 py-5">
        <span className="text-sm font-semibold tracking-wide text-white">
          AquaFix
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        {sections.map((section) => (
          <div key={section.label} className="mb-6">
            <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-sidebar-text-muted uppercase">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-sidebar-active text-white"
                        : "text-sidebar-text hover:bg-sidebar-active/60 hover:text-white"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        {email && (
          <div className="mb-2 truncate text-xs text-sidebar-text-muted">
            {email}
          </div>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-active/60 hover:text-white"
          >
            <LogOutIcon className="h-[18px] w-[18px]" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
