import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://reveryx-studio.tjfalkahn.workers.dev"),
  title: "REVERYX Studio",
  description: "Record anywhere. Finish anywhere. The intelligent standalone vocal studio and universal session handoff system.",
  alternates: { canonical: "https://reveryx-studio.tjfalkahn.workers.dev" },
  openGraph: {
    type: "website",
    url: "https://reveryx-studio.tjfalkahn.workers.dev",
    siteName: "REVERYX Studio",
    title: "REVERYX Studio",
    description: "Record anywhere. Finish anywhere. Load your song, capture protected vocals, collaborate remotely, and export to Pro Tools.",
    images: [{ url: "https://reveryx-studio.tjfalkahn.workers.dev/og-v2.png?v=26", width: 1200, height: 630, alt: "REVERYX — Record anywhere. Finish anywhere." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "REVERYX Studio",
    description: "Record anywhere. Finish anywhere. The intelligent standalone vocal studio.",
    images: ["https://reveryx-studio.tjfalkahn.workers.dev/og-v2.png?v=26"],
  },
  icons: {
    icon: [
      { url: "/reveryx-icon-192.png", type: "image/png", sizes: "192x168" },
      { url: "/reveryx-icon-512.png", type: "image/png", sizes: "512x448" },
    ],
    shortcut: "/reveryx-icon-192.png",
    apple: "/reveryx-icon-192.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
