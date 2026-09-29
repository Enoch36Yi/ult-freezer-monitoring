import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ULT Freezer Monitoring",
  description: "Live temperature monitoring for 21 ultra-low-temperature freezers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-plane font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
