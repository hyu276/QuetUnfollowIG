import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuetUnfollowIG · Live Crawl Test",
  description: "Realtime validation console for the QuetUnfollowIG browser crawler"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
