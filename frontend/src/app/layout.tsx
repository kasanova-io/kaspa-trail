// ABOUTME: Root layout for the Kaspa forensics UI.
// ABOUTME: Sets up dark theme, fonts, and global styles.

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kaspa Forensics",
  description: "Address graph analysis for the Kaspa blockchain",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
