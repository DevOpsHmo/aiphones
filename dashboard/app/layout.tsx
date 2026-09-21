import KitchenCursor from "./KitchenCursor";
import "./globals.css";

export const metadata = {
  title: "AI-Phone",
  description: "Panel de pedidos por teléfono",
  applicationName: "AI-Phone",
  appleWebApp: {
    capable: true,
    title: "AI-Phone",
    statusBarStyle: "black-translucent" as const
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover" as const,
  interactiveWidget: "resizes-content" as const
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <KitchenCursor />
        {children}
      </body>
    </html>
  );
}
