"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The Collect list picks up newly assigned orders without the technician
// pulling to refresh: every 30 seconds while the screen is open, and as soon
// as the app comes back to the front.
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    };
    const timer = window.setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router, seconds]);
  return null;
}
