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
  Flame,
  ArrowRight,
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <Clapperboard className="w-6 h-6 text-indigo-400" />
            <span>Shorts Productions Studio</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Compose and sequence multi-clip YouTube Shorts. Select templates, adjust subtitle styles, and render deterministically.
          </p>
        </div>

        <Link
          href="/productions/new"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition hover:scale-105"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>New Production</span>
        </Link>
      </div>

      {/* Productions Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
          <span className="text-xs">Loading productions...</span>
        </div>
      ) : productions.length === 0 ? (
        <div className="p-16 text-center rounded-3xl bg-slate-900/60 border border-slate-800 text-slate-500 text-xs space-y-4">
          <Clapperboard className="w-12 h-12 mx-auto opacity-30 text-indigo-400" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-300">No Productions Created Yet</h3>
            <p>Combine your extracted clips into your first viral Short production.</p>
          </div>
          <Link
            href="/productions/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Production</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {productions.map((prod) => {
            const isRendering = prod.status === "rendering";
            const isRendered = prod.status === "rendered";

            return (
              <div
                key={prod.id}
                className="p-5 rounded-3xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition shadow-xl flex flex-col justify-between space-y-4 group"
              >
                <div className="space-y-3">
                  {/* Status & Template Badges */}
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold uppercase tracking-wider">
                      {prod.template || "Ranking"} Template
                    </span>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                        isRendered
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : isRendering
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {prod.status}
                    </span>
                  </div>

                  {/* Production Title */}
                  <h3 className="text-sm font-bold text-white group-hover:text-indigo-400 transition line-clamp-2">
                    {prod.title || prod.name || "Untitled Short"}
                  </h3>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{prod.clips_count} clips</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
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
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <Link
                    href={`/productions/${prod.id}`}
                    className="flex-1 text-center py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                  >
                    Open Studio
                  </Link>

                  {isRendered ? (
                    <Link
                      href="/renders"
                      className="px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-semibold border border-emerald-500/30 transition flex items-center gap-1"
                    >
                      <Tv className="w-3.5 h-3.5" />
                      <span>View</span>
                    </Link>
                  ) : (
                    <button
                      onClick={(e) => handleRenderNow(prod.id, e)}
                      disabled={isRendering || prod.clips_count === 0}
                      className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition flex items-center gap-1"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Render</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(prod.id)}
                    className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition"
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
