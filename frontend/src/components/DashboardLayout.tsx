"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Menu,
  Plus,
  Sparkles,
  Layers,
  Search,
  ChevronRight,
} from "lucide-react";
import Sidebar from "./Sidebar";
import IngestModal from "./IngestModal";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [ingestModalTab, setIngestModalTab] = useState<"youtube" | "upload">("youtube");

  useEffect(() => {
    const handleOpenModal = (e: any) => {
      if (e.detail?.tab) {
        setIngestModalTab(e.detail.tab);
      }
      setIsIngestModalOpen(true);
    };

    window.addEventListener("open-ingest-modal", handleOpenModal);
    return () => window.removeEventListener("open-ingest-modal", handleOpenModal);
  }, []);

  const openIngest = (tab: "youtube" | "upload" = "youtube") => {
    setIngestModalTab(tab);
    setIsIngestModalOpen(true);
  };

  // Format breadcrumbs from pathname
  const getBreadcrumbs = () => {
    if (pathname === "/") return "Dashboard";
    const segments = pathname.split("/").filter(Boolean);
    const titles: Record<string, string> = {
      sources: "Sources",
      clips: "Clips Library",
      productions: "Productions",
      new: "Compose Short",
      edit: "Edit Clip",
      renders: "Render Vault",
    };

    return segments.map((s) => titles[s] || s).join(" / ");
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      {/* Sidebar Navigation */}
      <Sidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        onOpenIngest={openIngest}
      />

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Sleek Minimalist Top Header */}
        <header className="sticky top-0 z-20 h-14 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile Hamburger */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
              aria-label="Open Navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumb / Title */}
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
              <span className="text-zinc-500 hidden sm:inline">Studio</span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600 hidden sm:inline" />
              <span className="text-zinc-100 font-semibold tracking-tight">
                {getBreadcrumbs()}
              </span>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => openIngest("youtube")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs tracking-tight shadow-sm transition active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Add Video</span>
            </button>

            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 text-[11px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Studio</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>

      {/* Global Ingestion Modal */}
      <IngestModal
        isOpen={isIngestModalOpen}
        onClose={() => setIsIngestModalOpen(false)}
        defaultTab={ingestModalTab}
      />
    </div>
  );
}
