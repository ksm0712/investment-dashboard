import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://investment-dashboard-ox99.vercel.app"),
  title: "Thesis — Portfolio Intelligence",
  description: "A global portfolio register with live market data, lot-level accounting, analyst targets, and transparent action signals.",
  applicationName: "Thesis",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Thesis — Portfolio Intelligence",
    description: "Know what changed. Know what to do.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Thesis portfolio intelligence" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Thesis — Portfolio Intelligence",
    description: "Know what changed. Know what to do.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#102b24",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
