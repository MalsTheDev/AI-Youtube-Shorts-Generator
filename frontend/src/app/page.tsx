"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Video,
  Film,
  Clapperboard,
  Tv,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Flame,
  Plus,
  Play,
} from "lucide-react";

interface DashboardStats {
  total_sources: number;
  processing_sources: number;
  total_clips: number;
  favorite_clips: number;
  edited_clips: number;
  total_productions: number;
  total_renders: number;
  recent_sources: any[];
  recent_productions: any[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hero / Studio Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Studio V2 Architecture Active</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
              AI YouTube Shorts Studio
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Decoupled clip extraction, reusable multi-production clip repository, modular
              rendering engine, and instant non-destructive metadata editing.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 shrink-0">
            <Link
              href="/sources"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition"
            >
              <Video className="w-4 h-4 text-indigo-400" />
              <span>Manage Sources</span>
            </Link>
            <Link
              href="/productions/new"
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition hover:scale-105"
            >
              <Plus className="w-4 h-4" />
              <span>Compose New Short</span>
            </Link>
          </div>
        </div>

        {/* Ambient background glow */}
        <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Source Videos */}
        <Link
          href="/sources"
          className="group p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 transition shadow-lg relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Source Videos
            </span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 group-hover:scale-110 transition">
              <Video className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">
            {stats ? stats.total_sources : <Loader2 className="w-6 h-6 animate-spin text-slate-600" />}
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>
              {stats?.processing_sources ? `${stats.processing_sources} processing` : "All ready"}
            </span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition text-indigo-400" />
          </div>
        </Link>

        {/* Extracted Clips */}
        <Link
          href="/clips"
          className="group p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/50 transition shadow-lg relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Clips Library
            </span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition">
              <Film className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">
            {stats ? stats.total_clips : <Loader2 className="w-6 h-6 animate-spin text-slate-600" />}
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>
              {stats?.favorite_clips || 0} starred • {stats?.edited_clips || 0} edited
            </span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition text-amber-400" />
          </div>
        </Link>

        {/* Productions */}
        <Link
          href="/productions"
          className="group p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/50 transition shadow-lg relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Shorts Productions
            </span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition">
              <Clapperboard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">
            {stats ? stats.total_productions : <Loader2 className="w-6 h-6 animate-spin text-slate-600" />}
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>Sequenced studio drafts</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition text-purple-400" />
          </div>
        </Link>

        {/* Renders */}
        <Link
          href="/renders"
          className="group p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-emerald-500/50 transition shadow-lg relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Cached Renders
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition">
              <Tv className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-white">
            {stats ? stats.total_renders : <Loader2 className="w-6 h-6 animate-spin text-slate-600" />}
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>Ready for publishing</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition text-emerald-400" />
          </div>
        </Link>
      </div>

      {/* Main Grid: Active Pipeline & Quick Shortcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2 cols): Recent Sources & Clips */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active & Recent Sources */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Video className="w-4 h-4 text-indigo-400" />
                  <span>Recent Source Ingestions</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Raw videos ingested for transcript & clip candidate extraction
                </p>
              </div>
              <Link
                href="/sources"
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <span>View all</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {loading ? (
              <div className="py-8 flex justify-center text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : stats?.recent_sources && stats.recent_sources.length > 0 ? (
              <div className="space-y-3">
                {stats.recent_sources.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-4">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0 text-indigo-400 font-bold text-xs">
                        {s.clips_count || 0}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/sources/${s.id}`}
                          className="text-xs font-bold text-slate-200 hover:text-white truncate block"
                        >
                          {s.title}
                        </Link>
                        <span className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{s.clips_count} clips discovered</span>
                          <span>•</span>
                          <span className="capitalize">{s.status}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/sources/${s.id}`}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                      >
                        Inspect
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 text-xs">
                No sources ingested yet. Click &quot;Add Videos&quot; to begin!
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Quick Workflow Hub */}
        <div className="space-y-6">
          {/* Quick Production Flow Card */}
          <div className="bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-900 border border-indigo-500/20 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>V2 Production Workflow</span>
            </h3>
            <ol className="space-y-3 text-xs text-slate-300">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center shrink-0 text-[10px]">
                  1
                </span>
                <div>
                  <strong className="text-white block">Ingest Video</strong>
                  Zero rendering overhead. Fast Whisper transcription & Gemini highlight analysis.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center shrink-0 text-[10px]">
                  2
                </span>
                <div>
                  <strong className="text-white block">Clips Hub</strong>
                  Browse 200+ reusable clips with tags, character filters, and live dual-handle trim slider.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center shrink-0 text-[10px]">
                  3
                </span>
                <div>
                  <strong className="text-white block">Production Studio</strong>
                  Combine clips into a Short with Ranking/SingleTitle templates, animated subtitles, & AI metadata.
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center shrink-0 text-[10px]">
                  4
                </span>
                <div>
                  <strong className="text-white block">Deterministic Render</strong>
                  SHA-256 caching guarantees instant duplicate renders and zero wasted CPU cycles.
                </div>
              </li>
            </ol>

            <Link
              href="/clips"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition shadow-md shadow-indigo-600/20 mt-2"
            >
              <span>Explore Clips Library</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
