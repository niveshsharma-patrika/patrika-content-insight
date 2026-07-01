import type { Metadata } from "next";
import "./globals.css";
import { HeaderNav } from "@/components/HeaderNav";

export const metadata: Metadata = {
  title: "Patrika Enigma",
  description:
    "Editorial QA, realtime analytics, and notifications for Patrika.com.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <HeaderNav />
        <main className="flex-1">{children}</main>
        <footer className="border-t bg-card mt-12">
          <div className="mx-auto max-w-7xl px-6 py-4 text-xs text-muted flex items-center justify-between">
            <div>Built for the Patrika.com editorial team.</div>
            <div>Nivesh Sharma</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
