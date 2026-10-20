"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Video,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Play,
  Film,
  Search,
  Filter,
  XCircle,
  UploadCloud,
} from "lucide-react";

interface SourceItem {
  id: string;
  youtube_url: string;
  youtube_video_id?: string;
  title: string;
  duration?: number;
  category?: string;
  source_path?: string;
  stream_url?: string;
  thumbnail_url?: string;
  status: string;
  current_stage: string;
  progress: string;
  error_message?: string;
  clips_count: number;
  user_prompt?: string;
  created_at?: string;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isIngesting, setIsIngesting] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [category, setCategory] = useState("Family Guy");
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/sources");
      if (!res.ok) throw new Error("Failed to load sources");
      const data = await res.json();
      setSources(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
    const interval = setInterval(fetchSources, 3500);
    return () => clearInterval(interval);
  }, [fetchSources]);

  const handleOpenUploadModal = (tab: "youtube" | "upload" = "upload") => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("open-ingest-modal", { detail: { tab } })
      );
    }
  };

  const handleSingleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setIsIngesting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: [urlInput.trim()],
          category,
          target_duration: "Auto",
          layout_mode: "1:1",
          user_prompt: promptInput.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to enqueue source video.");
      }

      setUrlInput("");
      setPromptInput("");
      fetchSources();
    } catch (err: any) {
      setActionError(err.message || "Failed to ingest source.");
    } finally {
      setIsIngesting(false);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await fetch(`/api/sources/${id}/retry`, { method: "POST" });
      fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await fetch(`/api/sources/${id}/cancel`, { method: "POST" });
      fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this source and its clips?")) return;
    try {
      await fetch(`/api/sources/${id}`, { method: "DELETE" });
      fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const formatDuration = (secs?: number) => {
    if (!secs) return "--:--";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const filteredSources = sources.filter((s) => {
    const matchesSearch =
      (s.title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.category || "").toLowerCase().includes(searchQuery.toLowerCase());

    if (statusFilter === "processing") {
      return (
        matchesSearch &&
        (s.status === "queued" ||
          s.status === "processing" ||
          s.status === "downloading" ||
          s.status === "transcribing" ||
          s.status === "analyzing" ||
          s.current_stage === "queued" ||
          s.current_stage === "downloading" ||
          s.current_stage === "transcribing" ||
          s.current_stage === "analyzing")
      );
    }
    if (statusFilter === "completed") {
      return matchesSearch && s.status === "completed";
    }
    if (statusFilter === "failed") {
      return matchesSearch && s.status === "failed";
    }
    return matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Title & Ingestion Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 flex items-center gap-2.5">
            <Video className="w-5 h-5 text-zinc-400" />
            <span>Source Videos</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Ingest long-form YouTube videos or upload local MP4 episodes for highlight discovery and manual clipping.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenUploadModal("upload")}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-zinc-700 text-xs font-medium transition"
          >
            <UploadCloud className="w-3.5 h-3.5 text-zinc-400" />
            <span>Upload MP4 Video</span>
          </button>
        </div>
      </div>

      {/* Quick Ingest Bar */}
      <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 shadow-sm backdrop-blur-sm space-y-3">
        <form onSubmit={handleSingleIngest} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste YouTube Video URL (e.g. https://www.youtube.com/watch?v=...)"
              className="flex-1 px-4 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 font-mono transition"
              required
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2.5 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-600 transition"
            >
              <option value="Family Guy">Family Guy</option>
              <option value="Modern Family">Modern Family</option>
              <option value="Comedy">Comedy</option>
              <option value="Podcast">Podcast</option>
              <option value="General">General</option>
            </select>
            <button
              type="submit"
              disabled={isIngesting}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-900 font-medium text-xs shadow-sm transition shrink-0"
            >
              {isIngesting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Enqueuing...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Ingest URL</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-2.5 w-3.5 h-3.5 text-indigo-400" />
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="AI Focus Prompt (Optional, e.g. 'only stewie savage moments', 'funniest quotes', 'intense fights')"
                className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-950/80 border border-zinc-800/80 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>
        </form>

        {actionError && (
          <div className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sources..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-900/60 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition"
          />
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto overflow-x-auto">
          {[
            { id: "all", label: "All Sources" },
            { id: "processing", label: "Processing" },
            { id: "completed", label: "Ready" },
            { id: "failed", label: "Failed" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                statusFilter === tab.id
                  ? "bg-zinc-100 text-zinc-900 shadow-sm"
                  : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 border border-zinc-800/80"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sources List */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-zinc-500">
          <Loader2 className="w-7 h-7 animate-spin mb-3 text-zinc-400" />
          <span className="text-xs">Loading sources...</span>
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-zinc-900/30 border border-zinc-800/60 text-zinc-500 text-xs">
          No sources found matching your criteria.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSources.map((source) => {
            const isProcessing =
              source.status === "queued" ||
              source.status === "processing" ||
              source.status === "downloading" ||
              source.status === "transcribing" ||
              source.status === "analyzing" ||
              source.current_stage === "queued" ||
              source.current_stage === "downloading" ||
              source.current_stage === "transcribing" ||
              source.current_stage === "analyzing";

            const hasImageError = imageErrors[source.id];
            const thumbSrc = source.thumbnail_url || `/api/sources/${source.id}/thumbnail`;

            return (
              <div
                key={source.id}
                className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Left: Thumbnail & Details */}
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  {/* Thumbnail / Video icon */}
                  <div className="relative w-28 h-18 sm:w-36 sm:h-20 rounded-xl bg-zinc-950 overflow-hidden shrink-0 border border-zinc-800 group">
                    {!hasImageError ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={thumbSrc}
                        alt={source.title}
                        loading="lazy"
                        onError={() =>
                          setImageErrors((prev) => ({ ...prev, [source.id]: true }))
                        }
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600 bg-zinc-950">
                        <Video className="w-6 h-6 stroke-[1.5]" />
                      </div>
                    )}
                    {source.duration && (
                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-zinc-300">
                        {formatDuration(source.duration)}
                      </div>
                    )}
                  </div>

                  {/* Title, Meta, Pipeline Status */}
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/sources/${source.id}`}
                        className="text-sm font-medium text-zinc-100 hover:text-white transition truncate block"
                      >
                        {source.title}
                      </Link>
                      {source.youtube_url && (
                        <a
                          href={source.youtube_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-500 hover:text-zinc-300 shrink-0"
                          title="Open on YouTube"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700/60 text-[10px] font-medium text-zinc-300">
                        {source.category || "General"}
                      </span>

                      {source.user_prompt && (
                        <span
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-[10px] font-medium text-indigo-300 max-w-[220px] truncate"
                          title={`Focus: ${source.user_prompt}`}
                        >
                          <Sparkles className="w-2.5 h-2.5 shrink-0 text-indigo-400" />
                          <span className="truncate">&quot;{source.user_prompt}&quot;</span>
                        </span>
                      )}

                      <Link
                        href={`/sources/${source.id}#clips`}
                        className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white font-medium"
                      >
                        <Film className="w-3 h-3 text-zinc-400" />
                        <span>{source.clips_count} clips discovered</span>
                      </Link>
                    </div>

                    {/* Progress / Stage indicator */}
                    <div className="pt-1">
                      {isProcessing ? (
                        <div className="space-y-1.5 max-w-sm">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                              <span className="capitalize">
                                {source.current_stage && source.current_stage !== "queued"
                                  ? source.current_stage
                                  : source.status === "queued"
                                  ? "Queued"
                                  : source.status}
                              </span>
                            </span>
                            <span className="text-zinc-400 text-[10px] truncate max-w-[200px]" title={source.progress || ""}>
                              {source.progress || (source.status === "queued" ? "Queued for processing..." : "In progress...")}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <div className="h-full bg-amber-400/80 rounded-full animate-pulse w-3/4" />
                          </div>
                        </div>
                      ) : source.status === "failed" ? (
                        <div className="flex items-center gap-1.5 text-xs text-rose-400">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Processing failed: {source.progress || source.error_message}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Ready for studio clipping</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                  <Link
                    href={`/sources/${source.id}`}
                    className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700/60 transition"
                  >
                    Inspect & Transcript
                  </Link>

                  {isProcessing && (
                    <button
                      onClick={() => handleCancel(source.id)}
                      className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-rose-400 transition"
                      title="Cancel processing"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}

                  {source.status === "failed" && (
                    <button
                      onClick={() => handleRetry(source.id)}
                      className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition"
                      title="Retry processing"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(source.id)}
                    className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-rose-400 transition"
                    title="Delete source"
                  >
                    <Trash2 className="w-4 h-4" />
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

