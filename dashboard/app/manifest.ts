import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI-Phone",
    short_name: "AI-Phone",
    description: "Panel de pedidos por teléfono",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6d28d9",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      }
    ]
  };
}
