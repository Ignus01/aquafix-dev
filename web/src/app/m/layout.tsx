import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ServiceWorker } from "./components";
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
    <div className="flex min-h-dvh justify-center bg-[#e9eaee] text-[#0b1426]">
      <div className="relative flex min-h-dvh w-full max-w-[480px] flex-col bg-[#f8f8f8] pb-[64px]">
        {children}
        <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex h-[64px] w-full max-w-[480px] items-center justify-center bg-[#b3b3b3] pb-[env(safe-area-inset-bottom)]">
          <Link href="/m" className="flex flex-col items-center text-[16px] text-black">
            <HomeIcon className="h-7 w-7" />
            Home
          </Link>
        </nav>
      </div>
      <ServiceWorker />
    </div>
  );
}
