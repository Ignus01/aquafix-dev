"use client";

import { useEffect, useRef } from "react";
import { SearchIcon, XIcon } from "./icons";

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="mx-4 mt-3 mb-1 flex h-[56px] overflow-hidden rounded-[8px] border border-[#dfe2e8] bg-white">
      <div className="flex w-[76px] shrink-0 items-center justify-center border-r border-[#dfe2e8] text-[#0b1426]">
        <SearchIcon className="h-5 w-5" />
      </div>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3.5 text-[19px] outline-none placeholder:text-[#7a8190]"
      />
    </div>
  );
}

// "Are you sure?" with Proceed / Cancel — the PWA's Confirmation dialog.
export function ConfirmDialog({
  open,
  title = "Confirmation",
  message = "Are you sure?",
  onProceed,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message?: string;
  onProceed: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[22vh]" role="dialog" aria-modal="true">
      <div className="w-full max-w-[440px] rounded-[10px] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#dfe2e8] px-5 py-4">
          <h2 className="text-[20px] font-bold">{title}</h2>
          <button type="button" onClick={onCancel} aria-label="Close">
            <XIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="px-5 py-5 text-[19px]">{message}</p>
        <div className="flex gap-3 px-5 pb-5">
          <button type="button" onClick={onProceed} className="h-[48px] rounded-[8px] bg-black px-6 text-[17px] text-white">
            Proceed
          </button>
          <button type="button" onClick={onCancel} className="h-[48px] rounded-[8px] border border-[#dfe2e8] bg-white px-6 text-[17px]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// A full-screen sheet over the page (photos, pick lists).
export function Sheet({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-[480px] flex-col bg-[#f8f8f8]" role="dialog" aria-modal="true">
      <div className="flex h-[56px] shrink-0 items-center justify-center bg-[#3a3cd6] px-3 text-[19px] font-semibold text-white">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="flex shrink-0 gap-3 border-t border-[#dfe2e8] bg-[#f8f8f8] px-4 py-3">
        {footer ?? (
          <button type="button" onClick={onClose} className="h-[48px] w-full rounded-[8px] border border-[#dfe2e8] bg-white text-[17px]">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

// Registers the service worker for the field app (scope /m/).
export function ServiceWorker() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !("serviceWorker" in navigator)) return;
    done.current = true;
    navigator.serviceWorker.register("/sw.js", { scope: "/m/" }).catch(() => {});
  }, []);
  return null;
}
