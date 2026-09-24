"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Tv,
  Play,
  Download,
  Share2,
  Trash2,
  ExternalLink,
  Clock,
  HardDrive,
  Hash,
  Loader2,
  AlertCircle,
  Clapperboard,
  Sparkles,
  X,
} from "lucide-react";

interface RenderItem {
  id: string;
  production_id?: string;
  title: string;
  template?: string;
  aspect_ratio?: string;
  duration?: number;
  output_path: string;
  stream_url?: string;
  file_size?: number;
  render_hash?: string;
  created_at?: string;
}

export default function RendersPage() {
  const [renders, setRenders] = useState<RenderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewRender, setPreviewRender] = useState<RenderItem | null>(null);

  const fetchRenders = useCallback(async () => {
    try {
      const res = await fetch("/api/renders");
      if (!res.ok) throw new Error("Failed to load renders.");
      const data = await res.json();
      setRenders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRenders();
  }, [fetchRenders]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this render?")) return;
    try {
      await fetch(`/api/renders/${id}`, { method: "DELETE" });
      fetchRenders();
    } catch (err) {
      console.error(err);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "0 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
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
            <Tv className="w-6 h-6 text-emerald-400" />
            <span>Cached Renders Gallery</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Deterministic MP4 outputs generated from productions. Verified and cached by SHA-256 hash.
          </p>
        </div>

        <Link
          href="/productions"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold transition"
        >
          <Clapperboard className="w-3.5 h-3.5" />
          <span>Productions Studio</span>
        </Link>
      </div>

      {/* Renders Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3 text-emerald-500" />
          <span className="text-xs">Loading renders...</span>
        </div>
      ) : renders.length === 0 ? (
        <div className="p-16 text-center rounded-3xl bg-slate-900/60 border border-slate-800 text-slate-500 text-xs space-y-3">
          <Tv className="w-12 h-12 mx-auto opacity-30 text-emerald-400" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-300">No Rendered Shorts Yet</h3>
            <p>Open a Production and click &quot;Render Short&quot; to compile your first video.</p>
          </div>
          <Link
            href="/productions"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-slate-950 font-bold text-xs hover:bg-emerald-500 shadow-md shadow-emerald-600/20"
          >
            <span>Go to Productions</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {renders.map((render) => {
            return (
              <div
                key={render.id}
                className="group p-4 rounded-3xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition shadow-xl flex flex-col justify-between space-y-3 overflow-hidden"
              >
                {/* 9:16 Preview Container */}
                <div
                  onClick={() => setPreviewRender(render)}
                  className="relative aspect-[9/16] bg-black rounded-2xl overflow-hidden cursor-pointer flex items-center justify-center border border-slate-800/80 group-hover:border-emerald-500/40 transition"
                >
                  {render.stream_url ? (
                    <video
                      src={render.stream_url}
                      className="w-full h-full object-cover"
                      preload="metadata"
                    />
                  ) : (
                    <Tv className="w-10 h-10 text-slate-700" />
                  )}

                  {/* Play overlay button */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition">
                    <div className="p-3.5 rounded-full bg-emerald-600/90 text-slate-950 shadow-xl shadow-emerald-600/40 group-hover:scale-110 transition">
                      <Play className="w-4 h-4 fill-current translate-x-0.5" />
                    </div>
                  </div>

                  {/* Duration badge */}
                  <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-full bg-slate-950/85 backdrop-blur-md text-[10px] font-mono text-slate-300 border border-slate-800">
                    {formatDuration(render.duration)}
                  </div>
                </div>

                {/* Info */}
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold text-slate-200 group-hover:text-white line-clamp-1">
                    {render.title || "Rendered Short"}
                  </h3>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>{formatFileSize(render.file_size)}</span>
                    <span>1080x1920 (9:16)</span>
                  </div>

                  {render.render_hash && (
                    <div className="text-[10px] text-slate-600 font-mono truncate">
                      SHA: {render.render_hash.slice(0, 16)}...
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1.5">
                  {render.stream_url && (
                    <a
                      href={render.stream_url}
                      download={`Short_${render.id}.mp4`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                      title="Download MP4"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  )}

                  {render.production_id && (
                    <Link
                      href={`/productions/${render.production_id}`}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                      title="Open Production Studio"
                    >
                      <Clapperboard className="w-3.5 h-3.5" />
                    </Link>
                  )}

                  <Link
                    href={`/publishing?render_id=${render.id}`}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-emerald-400 transition"
                    title="Publish to YouTube"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </Link>

                  <button
                    onClick={(e) => handleDelete(render.id, e)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition"
                    title="Delete render"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full 9:16 Player Modal */}
      {previewRender && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white truncate max-w-[220px]">
                {previewRender.title}
              </h3>
              <button
                onClick={() => setPreviewRender(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative aspect-[9/16] bg-black rounded-2xl overflow-hidden border border-slate-800">
              <video
                src={previewRender.stream_url}
                autoPlay
                controls
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-400 font-mono">
                {formatDuration(previewRender.duration)} • {formatFileSize(previewRender.file_size)}
              </span>

              {previewRender.stream_url && (
                <a
                  href={previewRender.stream_url}
                  download={`Short_${previewRender.id}.mp4`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download MP4</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
