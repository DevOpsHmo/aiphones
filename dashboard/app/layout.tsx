import "./globals.css";
import KitchenCursor from "./KitchenCursor";

export const metadata = {
  title: "AI-Phone",
  description: "Panel de pedidos por teléfono",
  applicationName: "AI-Phone",
  appleWebApp: {
    capable: true,
    title: "AI-Phone",
    statusBarStyle: "default" as const
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png", type: "image/png" }]
  }
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
