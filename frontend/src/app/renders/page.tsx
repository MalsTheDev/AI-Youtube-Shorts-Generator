"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Tv,
  Play,
  Download,
  Trash2,
  Clock,
  Loader2,
  Clapperboard,
  X,
} from "lucide-react";

interface RenderItem {
  id: string;
  production_id?: string;
  title?: string;
  header_title?: string;
  template?: string;
  aspect_ratio?: string;
  duration?: number;
  output_path?: string;
  output_file_path?: string;
  stream_url?: string;
  video_url?: string;
  file_size?: number;
  file_size_bytes?: number;
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
    if (!bytes || bytes <= 0) return "0 MB";
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2.5">
            <Tv className="w-5 h-5 text-zinc-400" />
            <span>Cached Renders Gallery</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Deterministic MP4 outputs cached by SHA-256 fingerprint for instantaneous delivery.
          </p>
        </div>

        <Link
          href="/productions"
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-xs font-medium transition"
        >
          <Clapperboard className="w-3.5 h-3.5 text-zinc-400" />
          <span>Productions Studio</span>
        </Link>
      </div>

      {/* Renders Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin mb-3 text-zinc-400" />
          <span className="text-xs">Loading renders...</span>
        </div>
      ) : renders.length === 0 ? (
        <div className="p-16 text-center rounded-2xl bg-zinc-900/30 border border-zinc-800 text-zinc-400 text-xs space-y-3">
          <Tv className="w-10 h-10 mx-auto text-zinc-600" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-zinc-200">No Rendered Shorts Yet</h3>
            <p className="text-zinc-400">Open a Production and click &quot;Render&quot; to compile your first video.</p>
          </div>
          <Link
            href="/productions"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 text-zinc-950 font-semibold text-xs hover:bg-white transition"
          >
            <span>Go to Productions</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {renders.map((render) => {
            const streamUrl = render.stream_url || render.video_url;
            const displayTitle = render.title || render.header_title || "Rendered Short";
            const fileSize = render.file_size ?? render.file_size_bytes ?? 0;

            return (
              <div
                key={render.id}
                className="group p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/60 transition shadow-sm flex flex-col justify-between space-y-3 overflow-hidden"
              >
                {/* 9:16 Preview Container */}
                <div
                  onClick={() => setPreviewRender(render)}
                  className="relative aspect-[9/16] bg-black rounded-xl overflow-hidden cursor-pointer flex items-center justify-center border border-zinc-800/80 group-hover:border-zinc-600 transition"
                >
                  {streamUrl ? (
                    <video
                      src={streamUrl}
                      className="w-full h-full object-cover"
                      preload="metadata"
                    />
                  ) : (
                    <Tv className="w-10 h-10 text-zinc-700" />
                  )}

                  {/* Play overlay button */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition">
                    <div className="p-3 rounded-full bg-zinc-100/90 text-zinc-950 shadow-lg group-hover:scale-105 transition">
                      <Play className="w-4 h-4 fill-current translate-x-0.5" />
                    </div>
                  </div>

                  {/* Duration badge */}
                  <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-zinc-950/80 backdrop-blur-md text-[10px] font-mono text-zinc-300 border border-zinc-800">
                    {formatDuration(render.duration)}
                  </div>
                </div>

                {/* Info */}
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-zinc-200 group-hover:text-white line-clamp-1">
                    {displayTitle}
                  </h3>

                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                    <span>{formatFileSize(fileSize)}</span>
                    <span>9:16 Shorts</span>
                  </div>

                  {render.render_hash && (
                    <div className="text-[10px] text-zinc-400 font-mono truncate">
                      SHA: {render.render_hash.slice(0, 16)}...
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-1.5">
                  {streamUrl && (
                    <a
                      href={streamUrl}
                      download={`Short_${render.id}.mp4`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
                      title="Download MP4"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  )}

                  {render.production_id && (
                    <Link
                      href={`/productions/${render.production_id}`}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                      title="Open Production Studio"
                    >
                      <Clapperboard className="w-3.5 h-3.5" />
                    </Link>
                  )}

                  <button
                    onClick={(e) => handleDelete(render.id, e)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition"
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
      {previewRender && (() => {
        const modalStreamUrl = previewRender.stream_url || previewRender.video_url;
        const modalTitle = previewRender.title || previewRender.header_title || "Rendered Short";
        const modalFileSize = previewRender.file_size ?? previewRender.file_size_bytes ?? 0;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
            <div className="relative w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
                <h3 className="text-xs font-semibold text-zinc-100 truncate max-w-[220px]">
                  {modalTitle}
                </h3>
                <button
                  onClick={() => setPreviewRender(null)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="relative aspect-[9/16] bg-black rounded-xl overflow-hidden border border-zinc-800">
                {modalStreamUrl ? (
                  <video
                    src={modalStreamUrl}
                    autoPlay
                    controls
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600">
                    <Tv className="w-10 h-10" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-zinc-400 font-mono">
                  {formatDuration(previewRender.duration)} • {formatFileSize(modalFileSize)}
                </span>

                {modalStreamUrl && (
                  <a
                    href={modalStreamUrl}
                    download={`Short_${previewRender.id}.mp4`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
