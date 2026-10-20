"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Clapperboard,
  Plus,
  Play,
  Clock,
  Sparkles,
  Tv,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Layers,
} from "lucide-react";

interface ProductionItem {
  id: string;
  title: string;
  name?: string;
  template: string;
  aspect_ratio: string;
  layout_mode: string;
  status: string;
  render_progress?: string;
  clips_count: number;
  total_duration: number;
  created_at?: string;
  render_id?: string;
}

export default function ProductionsPage() {
  const [productions, setProductions] = useState<ProductionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProductions = useCallback(async () => {
    try {
      const res = await fetch("/api/productions");
      if (!res.ok) throw new Error("Failed to load productions");
      const data = await res.json();
      setProductions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProductions();
    const interval = setInterval(fetchProductions, 4000);
    return () => clearInterval(interval);
  }, [fetchProductions]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this production?")) return;
    try {
      await fetch(`/api/productions/${id}`, { method: "DELETE" });
      fetchProductions();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRenderNow = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/productions/${id}/render`, { method: "POST" });
      fetchProductions();
    } catch (err) {
      console.error(err);
    }
  };

  const formatDuration = (secs?: number) => {
    if (!secs) return "0s";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2.5">
            <Clapperboard className="w-5 h-5 text-zinc-400" />
            <span>Shorts Productions</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Compose and sequence multi-clip YouTube Shorts with animated subtitles and templates.
          </p>
        </div>

        <Link
          href="/productions/new"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-sm transition active:scale-[0.98]"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New Production</span>
        </Link>
      </div>

      {/* Productions Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin mb-3 text-zinc-400" />
          <span className="text-xs">Loading productions...</span>
        </div>
      ) : productions.length === 0 ? (
        <div className="p-16 text-center rounded-2xl bg-zinc-900/30 border border-zinc-800 text-zinc-400 text-xs space-y-4">
          <Clapperboard className="w-10 h-10 mx-auto text-zinc-600" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-zinc-200">No Productions Created Yet</h3>
            <p className="text-zinc-400">Combine your extracted clips into your first viral Short production.</p>
          </div>
          <Link
            href="/productions/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Production</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {productions.map((prod) => {
            const isRendering = prod.status === "rendering";
            const isRendered = prod.status === "rendered";

            return (
              <div
                key={prod.id}
                className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/60 transition shadow-sm flex flex-col justify-between space-y-4 group"
              >
                <div className="space-y-3">
                  {/* Status & Template Badges */}
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 text-[10px] font-mono uppercase tracking-wider">
                      {prod.template || "Ranking"}
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono capitalize ${
                        isRendered
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : isRendering
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                          : "bg-zinc-800 text-zinc-400 border border-zinc-700/50"
                      }`}
                    >
                      {prod.status}
                    </span>
                  </div>

                  {/* Production Title */}
                  <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition line-clamp-2">
                    {prod.title || prod.name || "Untitled Short"}
                  </h3>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs text-zinc-400 font-mono">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{prod.clips_count} clips</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{formatDuration(prod.total_duration)}</span>
                    </div>
                  </div>

                  {/* Render progress message */}
                  {isRendering && prod.render_progress && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span className="truncate">{prod.render_progress}</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <Link
                    href={`/productions/${prod.id}`}
                    className="flex-1 text-center py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
                  >
                    Open Studio
                  </Link>

                  {isRendered ? (
                    <Link
                      href="/renders"
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/30 transition flex items-center gap-1"
                    >
                      <Tv className="w-3.5 h-3.5" />
                      <span>View</span>
                    </Link>
                  ) : (
                    <button
                      onClick={(e) => handleRenderNow(prod.id, e)}
                      disabled={isRendering || prod.clips_count === 0}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 text-xs font-semibold shadow-sm transition flex items-center gap-1"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Render</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(prod.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition"
                    title="Delete production"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
