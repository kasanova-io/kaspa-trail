// ABOUTME: Root layout for the Kaspa forensics UI.
// ABOUTME: Loads Chakra Petch + Victor Mono fonts, noise texture overlay, and global styles.

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Victor+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <div className="noise-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
