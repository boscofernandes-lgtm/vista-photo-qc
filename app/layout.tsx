import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StayVista FrameCheck",
  description: "Premium hospitality photography quality control & scoring for StayVista listings",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
