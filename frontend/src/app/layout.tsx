import type { Metadata } from "next";
import "./globals.css";
import DashboardLayout from "@/components/DashboardLayout";

export const metadata: Metadata = {
  title: "AI YouTube Shorts Generator - Viral Ranking Studio",
  description: "Asynchronous batch video processing, clips repository, and multi-channel YouTube publisher",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-zinc-800 selection:text-white min-h-screen bg-zinc-950 text-zinc-100">
        <DashboardLayout>
          {children}
        </DashboardLayout>
      </body>
    </html>
  );
}

