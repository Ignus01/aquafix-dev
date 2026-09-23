"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangleIcon,
  ClipboardCheckIcon,
  GridIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
  XIcon,
} from "./icons";

type NavItem = { href: string; label: string; icon: typeof GridIcon };
type NavSection = { label: string; items: NavItem[] };

// Desktop: a fixed sidebar. Phones (field users logging incidents): a top bar
// with a menu button that slides the same sidebar in.
export function Sidebar({
  email,
  isSystemAdmin,
  signOutAction,
}: {
  email: string | null;
  isSystemAdmin: boolean;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 bg-sidebar px-4 text-white md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-control p-1.5 text-sidebar-text hover:bg-sidebar-active hover:text-white"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold tracking-wide">AquaFix</span>
      </header>

      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-text md:flex">
        <SidebarContent email={email} isSystemAdmin={isSystemAdmin} signOutAction={signOutAction} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="relative flex w-64 max-w-[80%] flex-col bg-sidebar text-sidebar-text shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-3 rounded-control p-1.5 text-sidebar-text hover:bg-sidebar-active hover:text-white"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <SidebarContent
              email={email}
              isSystemAdmin={isSystemAdmin}
              signOutAction={signOutAction}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}

function SidebarContent({
  email,
  isSystemAdmin,
  signOutAction,
  onNavigate,
}: {
  email: string | null;
  isSystemAdmin: boolean;
  signOutAction: () => Promise<void>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const sections: NavSection[] = [
    {
      label: "Operations",
      items: [
        { href: "/admin/incidents", label: "Incidents", icon: AlertTriangleIcon },
        { href: "/admin/masterdata", label: "Master Data", icon: GridIcon },
        {
          href: "/admin/inspection-setup",
          label: "Inspection Setup",
          icon: ClipboardCheckIcon,
        },
      ],
    },
    ...(isSystemAdmin
      ? [
          {
            label: "Setup",
            items: [
              { href: "/admin/users", label: "Users", icon: UsersIcon },
              { href: "/admin/settings", label: "System Settings", icon: SettingsIcon },
            ],
          },
        ]
      : []),
  ];

  return (
    <>
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
                    onClick={onNavigate}
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
    </>
  );
}
