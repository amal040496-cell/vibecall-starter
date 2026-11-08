import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibeCall — Meet someone new",
  description: "Anonymous 1-to-1 video conversations for adults.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
