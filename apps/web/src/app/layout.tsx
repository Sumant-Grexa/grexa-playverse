import type { Metadata } from "next";
import localFont from "next/font/local";
import { Sora } from "next/font/google";
import "./globals.css";

const pixel = localFont({
  src: "../fonts/upheavtt.ttf",
  variable: "--font-pixel",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
});

export const metadata: Metadata = {
  title: "Grexa Playverse",
  description: "Office tournament auction and leaderboard",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${pixel.variable} ${sora.variable}`}>{children}</body>
    </html>
  );
}
