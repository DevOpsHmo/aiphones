import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI-Phone",
    short_name: "AI-Phone",
    description: "Panel de pedidos por teléfono",
    start_url: "/",
    display: "standalone",
    background_color: "#5b21b6",
    theme_color: "#5b21b6",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
