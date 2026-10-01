import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AquaFix Field",
    short_name: "AquaFix",
    description: "AquaFix field data capture: inspections, incidents, services and stock.",
    start_url: "/m",
    scope: "/m/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8f8f8",
    theme_color: "#3a3cd6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
