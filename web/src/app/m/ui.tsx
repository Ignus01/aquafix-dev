import Link from "next/link";
import { ChevronLeftIcon } from "./icons";

export const mInput =
  "w-full rounded-[8px] border border-[#dfe2e8] bg-white px-3.5 text-[17px] text-[#0b1426] outline-none focus:border-[#3a3cd6] h-[52px] disabled:bg-[#f0f1f4] disabled:text-[#6b7280]";
export const mLabel = "mb-1.5 block text-[18px] font-semibold text-[#0b1426]";
export const mBtnDark =
  "h-[48px] rounded-[8px] bg-black px-6 text-[17px] font-medium text-white disabled:opacity-60";
export const mBtnGreen =
  "h-[48px] rounded-[8px] bg-[#3bb54a] px-6 text-[17px] font-medium text-white disabled:opacity-60";
export const mBtnLight =
  "h-[48px] rounded-[8px] border border-[#dfe2e8] bg-white px-6 text-[17px] text-[#0b1426] disabled:opacity-60";

// The blue title bar. `home` shows the brand mark (Home screens); other
// screens get a back arrow.
export function Header({ title, backHref, brand }: { title: string; backHref?: string; brand?: boolean }) {
  return (
    <header className="sticky top-0 z-30 flex h-[56px] shrink-0 items-center bg-[#3a3cd6] px-3 text-white shadow">
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
    <div className="fixed inset-x-0 bottom-[64px] z-30 mx-auto flex w-full max-w-[480px] items-center justify-between border-t border-[#dfe2e8] bg-[#f8f8f8] px-4 py-3">
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
    <div className="flex items-center gap-3 px-5 py-4 text-[19px] font-semibold text-[#0b1426]">
      {icon}
      {children}
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
    <span className={`rounded-[6px] px-3 py-1 text-[18px] font-semibold text-white ${STATUS_STYLE[status] ?? "bg-[#6b7280]"}`}>
      {label}
    </span>
  );
}
