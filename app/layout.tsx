import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NUALANAN ERP 2.0", template: "%s | NUALANAN ERP" },
  description: "ระบบบริหารงานขาย สต็อก การผลิต QA และบัญชี สำหรับโรงงานนวลอนันต์",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f3d2e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
