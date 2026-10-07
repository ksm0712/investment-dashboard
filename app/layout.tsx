import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://thesis-karan.vercel.app"),
  title: "Thesis — Portfolio Intelligence",
  description: "Track purchase lots, market data, analyst targets, and explainable portfolio recommendations in one private workspace.",
  applicationName: "Thesis",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Thesis — Portfolio Intelligence",
    description: "A private portfolio tracker with auditable calculations and filing evidence.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Thesis portfolio intelligence" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Thesis — Portfolio Intelligence",
    description: "A private portfolio tracker with auditable calculations and filing evidence.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f8fa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
