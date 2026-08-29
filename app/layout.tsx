import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif, IBM_Plex_Mono, Noto_Color_Emoji } from "next/font/google";
import "./globals.css";

// Type (decided 2026-08-28, MASTER.md §Visual identity rule 4): one superfamily.
// Sans for UI, Serif for verbatim quotes only, Mono for counts and metadata.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexSerif = IBM_Plex_Serif({
  variable: "--font-plex-serif",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Emoji on paper (Reports & Exports Stage 2). Vercel's Chromium image ships no
// emoji face, so a customer's "🙌" printed as a blank box. Self-hosted like
// Plex; referenced ONLY from the .vb-print font stacks (app/globals.css), and
// Chrome fetches a fallback face only when a glyph is missing — the app never
// downloads it, the renderer does when a quote needs it.
const emoji = Noto_Color_Emoji({
  variable: "--font-emoji",
  subsets: ["emoji"],
  weight: "400",
  preload: false,
});

export const metadata: Metadata = {
  title: "Verbatim — Consumer Intelligence",
  description:
    "Media-based consumer intelligence for D2C brands — market research-grade insights from real audience conversations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable} ${emoji.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
