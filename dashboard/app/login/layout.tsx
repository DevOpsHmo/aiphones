import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover"
};

export default function LoginLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
