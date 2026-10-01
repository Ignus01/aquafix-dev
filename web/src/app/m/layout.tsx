import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OfflineBanner, SavedToast, ServiceWorker } from "./components";
import { HomeIcon } from "./icons";

export const metadata: Metadata = {
  title: "AquaFix Field",
  applicationName: "AquaFix Field",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AquaFix", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#3a3cd6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh justify-center bg-[#e9eaee] text-[#0b1426] [-webkit-tap-highlight-color:transparent]">
      <div className="relative flex min-h-dvh w-full max-w-[480px] flex-col bg-[#f4f5fa] pb-[calc(64px+env(safe-area-inset-bottom))] shadow-xl">
        {children}
        <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex h-[calc(64px+env(safe-area-inset-bottom))] w-full max-w-[480px] items-start justify-center border-t border-[#e6e8f0] bg-white pt-1.5 pb-[env(safe-area-inset-bottom)]">
          <Link href="/m" className="flex min-w-[96px] flex-col items-center rounded-[10px] px-4 py-1 text-[14px] font-semibold text-[#3a3cd6] active:bg-[#eef0fb]">
            <HomeIcon className="h-7 w-7" />
            Home
          </Link>
        </nav>
      </div>
      <OfflineBanner />
      <Suspense>
        <SavedToast />
      </Suspense>
      <ServiceWorker />
    </div>
  );
}
