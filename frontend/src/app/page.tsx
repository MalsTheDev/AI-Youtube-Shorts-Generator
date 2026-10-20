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
  Plus,
  Play,
  Share2,
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

  const triggerIngest = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("open-ingest-modal", { detail: { tab: "youtube" } }));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Studio Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
              Studio V2 Architecture
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Overview & Telemetry
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-xl">
            Real-time pipeline metrics, automated clip discovery, and high-performance render engine.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={triggerIngest}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-semibold border border-zinc-800/80 transition shadow-sm active:scale-[0.98]"
          >
            <Video className="w-3.5 h-3.5 text-zinc-400" />
            <span>Ingest Source</span>
          </button>
          <Link
            href="/productions/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold shadow-sm transition active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Compose Short</span>
          </Link>
        </div>
      </div>

      {/* Metrics Row: 4 Minimal Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Source Videos */}
        <Link
          href="/sources"
          className="group p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/70 transition shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Source Videos
            </span>
            <div className="w-7 h-7 rounded-lg bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-300 group-hover:text-white transition">
              <Video className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-zinc-100">
            {stats ? stats.total_sources : <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />}
          </div>
          <div className="mt-3 text-xs text-zinc-400 flex items-center justify-between pt-3 border-t border-zinc-800/50">
            <span className="font-mono text-[11px]">
              {stats?.processing_sources ? `${stats.processing_sources} active ingest` : "All sources ready"}
            </span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition text-zinc-500 group-hover:text-zinc-200" />
          </div>
        </Link>

        {/* Clips Library */}
        <Link
          href="/clips"
          className="group p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/70 transition shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Clips Library
            </span>
            <div className="w-7 h-7 rounded-lg bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-300 group-hover:text-white transition">
              <Film className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-zinc-100">
            {stats ? stats.total_clips : <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />}
          </div>
          <div className="mt-3 text-xs text-zinc-400 flex items-center justify-between pt-3 border-t border-zinc-800/50">
            <span className="font-mono text-[11px]">
              {stats?.favorite_clips || 0} starred • {stats?.edited_clips || 0} trimmed
            </span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition text-zinc-500 group-hover:text-zinc-200" />
          </div>
        </Link>

        {/* Productions */}
        <Link
          href="/productions"
          className="group p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/70 transition shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Productions
            </span>
            <div className="w-7 h-7 rounded-lg bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-300 group-hover:text-white transition">
              <Clapperboard className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-zinc-100">
            {stats ? stats.total_productions : <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />}
          </div>
          <div className="mt-3 text-xs text-zinc-400 flex items-center justify-between pt-3 border-t border-zinc-800/50">
            <span className="font-mono text-[11px]">Active timelines</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition text-zinc-500 group-hover:text-zinc-200" />
          </div>
        </Link>

        {/* Renders */}
        <Link
          href="/renders"
          className="group p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/70 transition shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              Cached Renders
            </span>
            <div className="w-7 h-7 rounded-lg bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-300 group-hover:text-white transition">
              <Tv className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-3xl font-semibold tracking-tight text-zinc-100">
            {stats ? stats.total_renders : <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />}
          </div>
          <div className="mt-3 text-xs text-zinc-400 flex items-center justify-between pt-3 border-t border-zinc-800/50">
            <span className="font-mono text-[11px]">Ready for export</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition text-zinc-500 group-hover:text-zinc-200" />
          </div>
        </Link>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2 cols): Recent Sources & Ingestions */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                  <Video className="w-4 h-4 text-zinc-400" />
                  <span>Recent Source Ingestions</span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Raw episodes processed for speech-to-text and AI scene discovery
                </p>
              </div>
              <Link
                href="/sources"
                className="text-xs font-semibold text-zinc-300 hover:text-white flex items-center gap-1 transition"
              >
                <span>View all</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center text-zinc-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : stats?.recent_sources && stats.recent_sources.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {stats.recent_sources.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between py-3 px-2 rounded-xl hover:bg-zinc-900/60 transition group"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-4">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center shrink-0 text-zinc-200 font-mono font-semibold text-xs">
                        {s.clips_count || 0}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/sources/${s.id}`}
                          className="text-xs font-medium text-zinc-200 hover:text-white truncate block transition"
                        >
                          {s.title}
                        </Link>
                        <span className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5 font-mono">
                          <span>{s.clips_count} clips discovered</span>
                          <span>•</span>
                          <span className={`capitalize ${s.status === "completed" ? "text-emerald-400" : "text-amber-400"}`}>
                            {s.status}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/sources/${s.id}`}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
                      >
                        Inspect
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-zinc-400 text-xs">
                No sources ingested yet. Click &quot;Ingest Source&quot; to begin!
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Pipeline Architecture Hub */}
        <div className="space-y-6">
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/60">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-zinc-400" />
                <span>Production Pipeline</span>
              </h3>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-800/60 text-zinc-400 border border-zinc-700/50">
                4-STAGE
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono font-semibold flex items-center justify-center shrink-0 text-[10px]">
                  1
                </div>
                <div>
                  <strong className="text-zinc-200 block text-xs">Ingest Video</strong>
                  <p className="text-zinc-400 text-[11px] leading-relaxed mt-0.5">
                    Fast Whisper transcription & Gemini highlight detection with zero rendering overhead.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono font-semibold flex items-center justify-center shrink-0 text-[10px]">
                  2
                </div>
                <div>
                  <strong className="text-zinc-200 block text-xs">Clips Hub</strong>
                  <p className="text-zinc-400 text-[11px] leading-relaxed mt-0.5">
                    Filter by character, hook rating, and virality score with precise dual-handle trim slider.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono font-semibold flex items-center justify-center shrink-0 text-[10px]">
                  3
                </div>
                <div>
                  <strong className="text-zinc-200 block text-xs">Timeline & Layout</strong>
                  <p className="text-zinc-400 text-[11px] leading-relaxed mt-0.5">
                    Sequence clips with Countdown or Single Title styling, animated karaoke captions, and overlays.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono font-semibold flex items-center justify-center shrink-0 text-[10px]">
                  4
                </div>
                <div>
                  <strong className="text-zinc-200 block text-xs">Deterministic Render</strong>
                  <p className="text-zinc-400 text-[11px] leading-relaxed mt-0.5">
                    SHA-256 fingerprint caching guarantees instant renders and zero duplicated compute.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Link
                href="/clips"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-zinc-800/80 hover:bg-zinc-800 text-zinc-200 font-semibold text-xs border border-zinc-700/60 transition shadow-sm"
              >
                <span>Browse Clips Repository</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
