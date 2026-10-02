"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
    <div className="mx-4 mt-3 mb-2 flex h-[54px] overflow-hidden rounded-[14px] border border-[#d5d9e4] bg-white shadow-sm focus-within:border-[#3a3cd6] focus-within:ring-4 focus-within:ring-[#3a3cd6]/15">
      <div className="flex w-[56px] shrink-0 items-center justify-center text-[#5b6480]">
        <SearchIcon className="h-5 w-5" />
      </div>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-3.5 text-[18px] outline-none placeholder:text-[#7a8190]"
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
          <button type="button" onClick={onCancel} className="h-[48px] rounded-[12px] border border-[#d5d9e4] bg-white px-6 text-[17px]">
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
      <div className="flex min-h-[56px] shrink-0 items-center justify-center bg-gradient-to-b from-[#4547e0] to-[#3a3cd6] px-3 pt-[env(safe-area-inset-top)] text-[19px] font-semibold text-white">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="flex shrink-0 gap-3 border-t border-[#e6e8f0] bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
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

// Banner shown while the phone has no connection (saves need one).
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 mx-auto max-w-[480px] bg-[#a4570a] px-4 py-2 text-center text-[15px] font-medium text-white">
      You&apos;re offline. Changes can&apos;t be saved until you reconnect.
    </div>
  );
}

// A short confirmation after a save: screens navigate to `?saved=<message>`
// and this shows it for a few seconds, then removes it from the address.
export function SavedToast() {
  const params = useSearchParams();
  const saved = params.get("saved");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!saved) return;
    setTimeout(() => setMessage(saved), 0);
    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    window.history.replaceState(window.history.state, "", url.toString());
    // Not cleaned up: removing ?saved= below re-runs this effect, which must not cancel the timers.
    setTimeout(() => setMessage(null), 3200);
  }, [saved]);
  if (!message) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-[150px] z-50 mx-auto flex max-w-[440px] items-center gap-2 rounded-[12px] bg-[#0b1426] px-4 py-3 text-[17px] font-medium text-white shadow-lg">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2fa43f]">✓</span>
      {message}
    </div>
  );
}
