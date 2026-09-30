import type { Metadata } from "next";
import "./globals.css";

// proxy.ts generates a per-response CSP nonce and passes it to Next through
// x-nonce. Static prerendering cannot attach that request nonce to the page's
// scripts, so keep the shell dynamic or the browser will block hydration.
export const dynamic = "force-dynamic";

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
