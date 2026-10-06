import type { Metadata, Viewport } from "next";
import { DM_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

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
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
