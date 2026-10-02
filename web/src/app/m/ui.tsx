import Link from "next/link";
import { ChevronLeftIcon } from "./icons";

export const mInput =
  "w-full rounded-[12px] border border-[#d5d9e4] bg-white px-4 text-[17px] text-[#0b1426] shadow-sm outline-none transition focus:border-[#3a3cd6] focus:ring-4 focus:ring-[#3a3cd6]/15 h-[54px] disabled:bg-[#f0f1f4] disabled:text-[#6b7280]";
export const mLabel = "mb-1.5 block text-[16px] font-semibold text-[#2a3350]";
export const mBtnDark =
  "h-[50px] rounded-[12px] bg-[#0b1426] px-6 text-[17px] font-semibold text-white shadow-sm transition active:scale-[0.97] disabled:opacity-60";
export const mBtnGreen =
  "h-[50px] min-w-[110px] rounded-[12px] bg-[#2fa43f] px-6 text-[17px] font-semibold text-white shadow-sm transition active:scale-[0.97] disabled:opacity-60";
export const mBtnLight =
  "h-[50px] rounded-[12px] border border-[#d5d9e4] bg-white px-6 text-[17px] font-medium text-[#0b1426] transition active:scale-[0.97] disabled:opacity-60";

// The blue title bar. `home` shows the brand mark (Home screens); other
// screens get a back arrow.
export function Header({ title, backHref, brand }: { title: string; backHref?: string; brand?: boolean }) {
  return (
    <header className="sticky top-0 z-30 flex min-h-[56px] shrink-0 items-center bg-gradient-to-b from-[#4547e0] to-[#3a3cd6] px-3 pt-[env(safe-area-inset-top)] text-white shadow-md">
      <div className="w-[88px]">
        {brand ? (
          <span className="text-[22px] font-semibold italic tracking-tight">Aquafix</span>
        ) : backHref ? (
          <Link href={backHref} aria-label="Back" className="flex h-10 w-10 items-center justify-center">
            <ChevronLeftIcon className="h-6 w-6" />
          </Link>
        ) : null}
      </div>
      <h1 className="flex-1 text-center text-[19px] font-semibold">{title}</h1>
      <div className="w-[88px]" />
    </header>
  );
}

// Fixed Cancel / Save bar that sits above the bottom Home bar.
export function FormFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mx-auto flex w-full max-w-[480px] items-center justify-between border-t border-[#e6e8f0] bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(20,26,51,0.06)] backdrop-blur">
      {children}
    </div>
  );
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[15px] text-[#d92d20]">{children}</p>;
}

export function Empty({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-[19px] font-medium text-[#5b6480]">
      {icon && <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eef0fb] text-[#3a3cd6]">{icon}</span>}
      {children}
    </div>
  );
}

// Grey placeholder rows shown while a screen loads (see loading.tsx).
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse bg-white" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-[#e6e8f0] px-4 py-4">
          <div className="h-5 w-2/3 rounded bg-[#e6e8f0]" />
          <div className="mt-3 h-4 w-1/2 rounded bg-[#eef0f5]" />
        </div>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-[#6b7280]",
  in_progress: "bg-[#0b86d8]",
  completed: "bg-[#3bb54a]",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-[15px] font-semibold text-white ${STATUS_STYLE[status] ?? "bg-[#6b7280]"}`}>
      {label}
    </span>
  );
}
