"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  ListVideo,
  Film,
  SlidersHorizontal,
  Share2,
  Sparkles,
  Activity,
} from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    {
      label: "Batch Queue",
      href: "/queue",
      icon: ListVideo,
      isActive: pathname === "/queue" || pathname === "/",
    },
    {
      label: "Clips Repository",
      href: "/clips",
      icon: Film,
      isActive: pathname === "/clips",
    },
    {
      label: "Review & Render",
      href: "/review",
      icon: SlidersHorizontal,
      isActive: pathname.startsWith("/review"),
    },
    {
      label: "YouTube Publisher",
      href: "/publishing",
      icon: Share2,
      isActive: pathname === "/publishing",
    },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link href="/queue" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-amber-500 p-0.5 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Layers className="w-5 h-5 text-indigo-400 group-hover:text-amber-400 transition-colors" />
            </div>
          </div>
          <div>
            <span className="font-black text-base tracking-tight text-white flex items-center gap-1.5">
              VIRAL SHORTS <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold border border-amber-500/20">STUDIO</span>
            </span>
            <span className="text-[10px] text-slate-400 font-medium tracking-wide block -mt-0.5">
              3x Concurrency & Multi-Channel
            </span>
          </div>
        </Link>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  item.isActive
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/25"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${item.isActive ? "text-amber-300" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Status Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-medium text-slate-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>MySQL & Redis Online</span>
          </div>
        </div>
      </div>
    </header>
  );
}
