"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { NAV_COOKIE, type NavGroupState } from "./nav-state";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BarChartIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  FlaskIcon,
  GridIcon,
  HomeIcon,
  ListChecksIcon,
  LogOutIcon,
  MenuIcon,
  PackageIcon,
  ReceiptIcon,
  SettingsIcon,
  SlidersIcon,
  TransferIcon,
  UploadIcon,
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
type NavSection = {
  label: string;
  items: NavItem[];
  // Setup and Admin start folded: people open them far less than daily work.
  defaultOpen: boolean;
  // Secondary sections sit at the bottom of the sidebar, under a divider.
  secondary?: boolean;
};

const STOCK_MANAGER = "/admin/stock-manager";
const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// The Stock Manager is one page of tabs; the Stock group splits it into
// Orders, Stock Summary, and Movements for every other document and the ledger.
const isOrders = ({ pathname, tab }: Loc) =>
  (pathname === STOCK_MANAGER && tab === "purchase-orders") || under(pathname, `${STOCK_MANAGER}/purchase-orders`);
const isSummary = ({ pathname, tab }: Loc) => pathname === STOCK_MANAGER && (tab ?? "summary") === "summary";

// Lab Results is the Quality page itself and its sample pages; Import and
// Parameters sit under the same path.
const QUALITY = "/admin/quality";
const isLabResults = ({ pathname }: Loc) => pathname === QUALITY || under(pathname, `${QUALITY}/samples`);

// Daily work first; configuration and administration folded at the bottom.
function navSections(isSystemAdmin: boolean, canImportLabResults: boolean, canBill: boolean): NavSection[] {
  return [
    {
      label: "Work",
      defaultOpen: true,
      items: [
        { href: "/admin/inspections", label: "Inspections", icon: ListChecksIcon },
        { href: "/admin/incidents", label: "Incidents", icon: AlertTriangleIcon },
        { href: "/admin/services", label: "Services", icon: WrenchIcon },
      ],
    },
    {
      label: "Quality",
      defaultOpen: true,
      items: [
        { href: QUALITY, label: "Lab Results", icon: FlaskIcon, isActive: isLabResults },
        ...(canImportLabResults
          ? [{ href: `${QUALITY}/import`, label: "Import Lab Results", icon: UploadIcon }]
          : []),
      ],
    },
    {
      label: "Stock",
      defaultOpen: true,
      items: [
        { href: `${STOCK_MANAGER}?tab=purchase-orders`, label: "Orders", icon: ReceiptIcon, isActive: isOrders },
        {
          href: `${STOCK_MANAGER}?tab=transactions`,
          label: "Movements",
          icon: TransferIcon,
          isActive: (loc) => under(loc.pathname, STOCK_MANAGER) && !isOrders(loc) && !isSummary(loc),
        },
        { href: `${STOCK_MANAGER}?tab=summary`, label: "Stock Summary", icon: BarChartIcon, isActive: isSummary },
      ],
    },
    ...(canBill
      ? [
          {
            label: "Billing",
            defaultOpen: true,
            items: [{ href: "/admin/billing", label: "Invoices", icon: ReceiptIcon }],
          },
        ]
      : []),
    {
      label: "Setup",
      defaultOpen: false,
      secondary: true,
      items: [
        { href: "/admin/masterdata", label: "Master Files", icon: GridIcon },
        { href: "/admin/stock", label: "Stock Master Files", icon: PackageIcon },
        { href: "/admin/inspection-setup", label: "Inspection Setup", icon: ClipboardCheckIcon },
        { href: `${QUALITY}/parameters`, label: "Quality Parameters", icon: SlidersIcon },
      ],
    },
    ...(isSystemAdmin
      ? [
          {
            label: "Admin",
            defaultOpen: false,
            secondary: true,
            items: [
              { href: "/admin/users", label: "User Management", icon: UsersIcon },
              { href: "/admin/logger-data", label: "Logger Data", icon: ActivityIcon },
              { href: "/admin/settings", label: "System Settings", icon: SettingsIcon },
            ],
          },
        ]
      : []),
  ];
}

function saveGroups(groups: NavGroupState) {
  // A year; read back by the admin layout so the server renders the same groups.
  document.cookie = `${NAV_COOKIE}=${encodeURIComponent(JSON.stringify(groups))}; path=/; max-age=31536000; samesite=lax`;
}

// Desktop: a fixed sidebar. Phones (field users logging incidents): a top bar
// with a menu button that slides the same sidebar in.
export function Sidebar({
  email,
  isSystemAdmin,
  canImportLabResults,
  canBill,
  initialGroups,
  signOutAction,
}: {
  email: string | null;
  isSystemAdmin: boolean;
  canImportLabResults: boolean;
  canBill: boolean;
  initialGroups: NavGroupState;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Section label -> open/closed as the user last left it. Shared by the
  // desktop sidebar and the phone drawer, and kept in a cookie.
  const [groups, setGroups] = useState<NavGroupState>(initialGroups);
  const setGroup = (label: string, isOpen: boolean) =>
    setGroups((g) => {
      const next = { ...g, [label]: isOpen };
      saveGroups(next);
      return next;
    });

  const content = {
    email,
    isSystemAdmin,
    canImportLabResults,
    canBill,
    signOutAction,
    groups,
    setGroup,
  };

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
        <SidebarContent {...content} />
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
            <SidebarContent {...content} onNavigate={() => setOpen(false)} />
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
  canImportLabResults,
  canBill,
  signOutAction,
  groups,
  setGroup,
  onNavigate,
}: {
  email: string | null;
  isSystemAdmin: boolean;
  canImportLabResults: boolean;
  canBill: boolean;
  signOutAction: () => Promise<void>;
  groups: NavGroupState;
  setGroup: (label: string, isOpen: boolean) => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const loc: Loc = { pathname, tab: useSearchParams().get("tab") };
  const isActive = (item: NavItem) => (item.isActive ? item.isActive(loc) : under(pathname, item.href));

  // Section label -> the pathname it was folded on while holding the current
  // page. Moving to another page in that section opens it again, so the
  // current page is never hidden for long.
  const [foldedOn, setFoldedOn] = useState<Record<string, string>>({});

  const sections = navSections(isSystemAdmin, canImportLabResults, canBill);

  const renderSection = (section: NavSection) => {
    const hasActive = section.items.some(isActive);
    const isOpen = hasActive ? foldedOn[section.label] !== pathname : (groups[section.label] ?? section.defaultOpen);
    const id = `nav-${section.label.replace(/\s+/g, "-").toLowerCase()}`;
    const toggle = () => {
      if (hasActive) {
        setFoldedOn((f) => {
          const next = { ...f };
          if (isOpen) next[section.label] = pathname;
          else delete next[section.label];
          return next;
        });
      }
      setGroup(section.label, !isOpen);
    };
    return (
      <div key={section.label} className="mb-3">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={id}
          onClick={toggle}
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
  };

  return (
    <>
      <div className="px-5 py-5">
        <span className="text-sm font-semibold tracking-wide text-white">AquaFix</span>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-4">
        <div className="mb-4">
          <NavLink
            item={{ href: "/admin", label: "Home", icon: HomeIcon }}
            active={pathname === "/admin"}
            onNavigate={onNavigate}
          />
        </div>

        {sections.filter((s) => !s.secondary).map(renderSection)}

        <div className="mt-auto border-t border-white/10 pt-3">
          {sections.filter((s) => s.secondary).map(renderSection)}
        </div>
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
