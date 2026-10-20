"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Video,
  Film,
  Clapperboard,
  Sparkles,
  Tv,
  Share2,
  Plus,
  PlusSquare,
  Layers,
  X,
  Radio,
  ExternalLink,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: any;
  isActive: boolean;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenIngest: (tab?: "youtube" | "upload") => void;
}

export default function Sidebar({ isOpen, onClose, onOpenIngest }: SidebarProps) {
  const pathname = usePathname();

  const navigationSections: NavSection[] = [
    {
      title: "Overview",
      items: [
        {
          label: "Dashboard",
          href: "/",
          icon: LayoutDashboard,
          isActive: pathname === "/",
        },
      ],
    },
    {
      title: "Media Library",
      items: [
        {
          label: "Sources",
          href: "/sources",
          icon: Video,
          isActive: pathname.startsWith("/sources"),
        },
        {
          label: "Clips Repository",
          href: "/clips",
          icon: Film,
          isActive: pathname.startsWith("/clips"),
        },
      ],
    },
    {
      title: "Studio Engine",
      items: [
        {
          label: "Productions",
          href: "/productions",
          icon: Clapperboard,
          isActive: pathname === "/productions" || (pathname.startsWith("/productions/") && pathname !== "/productions/new"),
        },
        {
          label: "Compose Short",
          href: "/productions/new",
          icon: PlusSquare,
          isActive: pathname === "/productions/new",
        },
      ],
    },
    {
      title: "Output",
      items: [
        {
          label: "Render Vault",
          href: "/renders",
          icon: Tv,
          isActive: pathname.startsWith("/renders"),
        },
      ],
    },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800/80 text-zinc-300 select-none">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-zinc-800/80 shrink-0">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-100 group-hover:border-zinc-700 transition">
            <Layers className="w-4 h-4 text-zinc-100" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-zinc-100">AI SHORTS</span>
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/60">
                STUDIO
              </span>
            </div>
            <span className="text-[10px] text-zinc-500 font-medium block -mt-0.5 tracking-wide">
              Viral Clip Architecture
            </span>
          </div>
        </Link>

        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
          aria-label="Close Sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Action Button */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <button
          onClick={() => onOpenIngest("youtube")}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs tracking-tight shadow-sm transition active:scale-[0.99]"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Add New Video</span>
        </button>
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-6 scrollbar-none">
        {navigationSections.map((section, sIdx) => (
          <div key={sIdx} className="space-y-1">
            <div className="px-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              {section.title}
            </div>
            <div className="space-y-0.5 mt-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => onClose()}
                    className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                      item.isActive
                        ? "bg-zinc-900/90 text-white font-semibold border border-zinc-800 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          item.isActive ? "text-indigo-400" : "text-zinc-500 group-hover:text-zinc-300"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-zinc-300 font-medium border border-zinc-700/50">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-zinc-800/80 shrink-0 bg-zinc-950/60">
        <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <div className="truncate">
              <span className="text-[11px] font-medium text-zinc-300 block truncate">Engine Online</span>
              <span className="text-[9px] text-zinc-500 font-mono block">FastAPI • v2.4</span>
            </div>
          </div>
          <div className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/50 border border-zinc-700/40">
            9:16
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:block w-64 h-screen sticky top-0 shrink-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity"
        />
      )}

      {/* Mobile Slide-in Drawer */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] transform transition-transform duration-200 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
