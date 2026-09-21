import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pedidos por Voz",
  description: "Dashboard de pedidos telefonicos atendidos por IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
