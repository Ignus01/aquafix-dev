"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangleIcon,
  BarChartIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  GridIcon,
  HomeIcon,
  ListChecksIcon,
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  ReceiptIcon,
  SettingsIcon,
  TransferIcon,
  UsersIcon,
  WrenchIcon,
  XIcon,
} from "./icons";

type Loc = { pathname: string; tab: string | null };
type NavItem = {
  href: string;
  label: string;
  icon: typeof GridIcon;
  // Defaults to the href's page and everything under it.
  isActive?: (loc: Loc) => boolean;
};
type NavSection = { label: string; items: NavItem[] };

const STOCK_MANAGER = "/admin/stock-manager";
const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// The Stock Manager is one page of tabs; the Stock group splits it the way
// the Mendix menu did: Orders, Summary, and Movements for every other document
// and the ledger.
const isOrders = ({ pathname, tab }: Loc) =>
  (pathname === STOCK_MANAGER && tab === "purchase-orders") || under(pathname, `${STOCK_MANAGER}/purchase-orders`);
const isSummary = ({ pathname, tab }: Loc) => pathname === STOCK_MANAGER && (tab ?? "summary") === "summary";

// Grouped as in the Mendix app's menu, so its users find things where they
// expect them.
function navSections(isSystemAdmin: boolean): NavSection[] {
  return [
    {
      label: "Master Data",
      items: [
        { href: "/admin/masterdata", label: "Master Files", icon: GridIcon },
        { href: "/admin/stock", label: "Stock Master Files", icon: PackageIcon },
        { href: "/admin/inspection-setup", label: "Inspection Setup", icon: ClipboardCheckIcon },
      ],
    },
    {
      label: "Asset Management",
      items: [
        { href: "/admin/inspections", label: "Inspections", icon: ListChecksIcon },
        { href: "/admin/incidents", label: "Incidents", icon: AlertTriangleIcon },
        { href: "/admin/services", label: "Services", icon: WrenchIcon },
      ],
    },
    {
      label: "Stock",
      items: [
        { href: `${STOCK_MANAGER}?tab=purchase-orders`, label: "Orders", icon: ReceiptIcon, isActive: isOrders },
        {
          href: `${STOCK_MANAGER}?tab=transactions`,
          label: "Movements",
          icon: TransferIcon,
          isActive: (loc) => under(loc.pathname, STOCK_MANAGER) && !isOrders(loc) && !isSummary(loc),
        },
        { href: `${STOCK_MANAGER}?tab=summary`, label: "Summary", icon: BarChartIcon, isActive: isSummary },
      ],
    },
    ...(isSystemAdmin
      ? [
          {
            label: "Admin",
            items: [
              { href: "/admin/users", label: "User Management", icon: UsersIcon },
              { href: "/admin/settings", label: "System Settings", icon: SettingsIcon },
            ],
          },
        ]
      : []),
  ];
}

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
      <header className="flex h-14 shrink-0 items-center gap-3 bg-sidebar px-4 text-white md:hidden print:hidden">
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

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-text md:flex print:hidden">
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

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-sidebar-active text-white" : "text-sidebar-text hover:bg-sidebar-active/60 hover:text-white"
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {item.label}
    </Link>
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
  const loc: Loc = { pathname, tab: useSearchParams().get("tab") };
  const isActive = (item: NavItem) => (item.isActive ? item.isActive(loc) : under(pathname, item.href));

  // Section label -> the pathname it was collapsed on. Moving to a page inside
  // a collapsed section opens it again, so the current page is never hidden.
  const [collapsed, setCollapsed] = useState<Record<string, string>>({});

  const sections = navSections(isSystemAdmin);

  return (
    <>
      <div className="px-5 py-5">
        <span className="text-sm font-semibold tracking-wide text-white">AquaFix</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-4">
          <NavLink
            item={{ href: "/admin", label: "Home", icon: HomeIcon }}
            active={pathname === "/admin"}
            onNavigate={onNavigate}
          />
        </div>

        {sections.map((section) => {
          const hasActive = section.items.some(isActive);
          const at = collapsed[section.label];
          const isOpen = at === undefined || (hasActive && at !== pathname);
          const id = `nav-${section.label.replace(/\s+/g, "-").toLowerCase()}`;
          return (
            <div key={section.label} className="mb-3">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() =>
                  setCollapsed((c) => {
                    const next = { ...c };
                    if (isOpen) next[section.label] = pathname;
                    else delete next[section.label];
                    return next;
                  })
                }
                className="group flex w-full items-center justify-between rounded-control px-3 py-1.5 text-[11px] font-semibold tracking-wider text-sidebar-text-muted uppercase transition-colors hover:text-white"
              >
                <span className="flex items-center gap-2">
                  {section.label}
                  {!isOpen && hasActive && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" aria-label="(current page)" />
                  )}
                </span>
                <ChevronRightIcon
                  className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-hover:opacity-100 ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
              {isOpen && (
                <div id={id} className="mt-1 flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <NavLink key={item.href} item={item} active={isActive(item)} onNavigate={onNavigate} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        {email && <div className="mb-2 truncate text-xs text-sidebar-text-muted">{email}</div>}
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
