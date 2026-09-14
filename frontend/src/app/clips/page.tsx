"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Film,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Play,
  Flame,
  Clock,
  Layers,
  Search,
  ExternalLink,
  SlidersHorizontal,
  Check,
  RefreshCw,
  Loader2,
  ArrowRight,
  Filter,
  Trash2,
} from "lucide-react";

function toStreamUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const clean = String(raw).replace(/\\/g, "/").trim();
  if (!clean) return null;
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (clean.includes("output/")) {
    const rel = clean.split("output/").pop();
    return `/output/${rel}`;
  }
  if (clean.startsWith("/output/")) return clean;
  const filename = clean.split("/").pop();
  if (filename && filename.endsWith(".mp4")) {
    return `/output/${filename}`;
  }
  return clean.startsWith("/") ? clean : `/${clean}`;
}

interface ClipItem {
  id: string;
  video_id: string;
  rank_title: string;
  emoji: string;
  start_time: number;
  end_time: number;
  virality_score: number;
  hook_sentence?: string;
  source_stream_url?: string;
  video_title?: string;
}

interface VideoGroup {
  video_id: string;
  video_title: string;
  youtube_url: string;
  duration?: number;
  source_stream_url?: string;
  clips: ClipItem[];
}

export default function ClipsRepositoryPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<VideoGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch clips grouped by video
  const fetchClips = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/clips");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data: VideoGroup[] = await res.json();
      setGroups(data);

      // Default all groups to expanded
      const initialExp: Record<string, boolean> = {};
      data.forEach((g) => {
        initialExp[g.video_id] = true;
      });
      setExpandedGroups(initialExp);
    } catch (err: any) {
      console.error("Failed to fetch clips:", err);
      setErrorMsg("Failed to load clips repository. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  // Toggle group expansion
  const toggleGroup = (videoId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [videoId]: !prev[videoId],
    }));
  };

  // Toggle clip selection
  const toggleClipSelection = (clipId: string) => {
    setSelectedClipIds((prev) =>
      prev.includes(clipId) ? prev.filter((id) => id !== clipId) : [...prev, clipId]
    );
  };

  // Select all clips in a specific video
  const selectAllInGroup = (group: VideoGroup) => {
    const groupClipIds = group.clips.map((c) => c.id);
    const allSelected = groupClipIds.every((id) => selectedClipIds.includes(id));
    if (allSelected) {
      setSelectedClipIds((prev) => prev.filter((id) => !groupClipIds.includes(id)));
    } else {
      setSelectedClipIds((prev) => Array.from(new Set([...prev, ...groupClipIds])));
    }
  };

  // Select / Deselect all clips across all videos
  const toggleSelectAllGlobal = () => {
    const allIds = groups.flatMap((g) => g.clips.map((c) => c.id));
    if (selectedClipIds.length === allIds.length) {
      setSelectedClipIds([]);
    } else {
      setSelectedClipIds(allIds);
    }
  };

  // Build custom short from selection
  const handleCreateShortFromSelection = async () => {
    if (selectedClipIds.length === 0) return;
    setIsBuilding(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/shorts/custom-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_ids: selectedClipIds,
          header_title: "RANKING BEST MOMENTS",
          layout_mode: "1:1",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to create custom short.");
      }

      const data = await res.json();
      if (data.redirect_url) {
        router.push(data.redirect_url);
      }
    } catch (err: any) {
      console.error("Custom build error:", err);
      setErrorMsg(err.message || "Failed to build short from selection.");
      setIsBuilding(false);
    }
  };

  // Clear all clips and videos from repository
  const handleClearAllClips = async () => {
    if (!confirm("Are you sure you want to delete all extracted clips and videos from the repository?")) return;
    try {
      await fetch("/api/clips/clear", { method: "POST" });
      setGroups([]);
      setSelectedClipIds([]);
    } catch (err) {
      console.error("Error clearing clips:", err);
    }
  };

  // Filter groups by search query
  const filteredGroups = groups
    .map((g) => {
      const matchVideo = g.video_title.toLowerCase().includes(searchQuery.toLowerCase());
      const filteredClips = g.clips.filter(
        (c) =>
          matchVideo ||
          c.rank_title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (c.hook_sentence && c.hook_sentence.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      return { ...g, clips: filteredClips };
    })
    .filter((g) => g.clips.length > 0);

  const totalClipsCount = groups.reduce((acc, g) => acc + g.clips.length, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 pb-36">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Film className="w-5 h-5" />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white">
                Clips Repository
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700">
                {totalClipsCount} Moments Extracted
              </span>
            </div>
            <p className="text-sm text-slate-400">
              Browse all AI-extracted viral candidate clips across your YouTube catalog. Combine arbitrary clips into a new Ranking Short.
            </p>
          </div>

          {/* Action Bar / Search */}
          <div className="flex items-center gap-3">
            <div className="relative w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clips or video title..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={fetchClips}
              className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 transition"
              title="Refresh repository"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={handleClearAllClips}
              className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-rose-950/60 hover:border-rose-800/80 rounded-xl text-slate-400 hover:text-rose-400 transition cursor-pointer"
              title="Delete all clips from repository"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-xs hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 space-y-3">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Loading clips from MySQL database...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredGroups.length === 0 && (
          <div className="text-center py-24 bg-slate-900/40 rounded-2xl border border-slate-800/80 p-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 mx-auto flex items-center justify-center border border-indigo-500/20">
              <Film className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-200">No clips found</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {searchQuery ? "No clips match your search query." : "Process videos in the Batch Queue to extract viral candidate moments."}
              </p>
            </div>
            <Link
              href="/queue"
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl text-xs font-bold text-white shadow-lg shadow-indigo-500/20 hover:scale-105 transition"
            >
              Go to Batch Queue
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Grouped Accordion List */}
        {!loading && filteredGroups.length > 0 && (
          <div className="space-y-6">
            {filteredGroups.map((group) => {
              const isExpanded = !!expandedGroups[group.video_id];
              const groupClipIds = group.clips.map((c) => c.id);
              const groupSelectedCount = groupClipIds.filter((id) => selectedClipIds.includes(id)).length;
              const allInGroupSelected = groupClipIds.length > 0 && groupSelectedCount === groupClipIds.length;

              return (
                <div
                  key={group.video_id}
                  className="rounded-2xl border border-slate-800/90 bg-slate-900/40 overflow-hidden shadow-sm transition"
                >
                  {/* Accordion Header Card */}
                  <div className="p-4 sm:px-6 bg-slate-900/80 border-b border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div
                      onClick={() => toggleGroup(group.video_id)}
                      className="flex items-center gap-3 cursor-pointer flex-1 group"
                    >
                      <button className="p-1 rounded-lg bg-slate-800 text-slate-400 group-hover:text-white transition">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
                            YouTube Video
                          </span>
                          <h2 className="text-sm font-bold text-slate-100 group-hover:text-indigo-400 transition">
                            {group.video_title}
                          </h2>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                          <a
                            href={group.youtube_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-500 hover:text-indigo-400 flex items-center gap-1 transition"
                          >
                            <span>Watch on YouTube</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <span>•</span>
                          <span>{group.clips.length} clip candidate{group.clips.length !== 1 ? "s" : ""}</span>
                          {group.duration ? (
                            <>
                              <span>•</span>
                              <span>Duration: {Math.round(group.duration)}s</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Group Selection Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => selectAllInGroup(group)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          allInGroupSelected
                            ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                            : "bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {allInGroupSelected ? "Deselect Group" : `Select All (${group.clips.length})`}
                      </button>
                    </div>
                  </div>

                  {/* Accordion Body: Clips Grid */}
                  {isExpanded && (
                    <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {group.clips.map((clip) => {
                        const isSelected = selectedClipIds.includes(clip.id);
                        const duration = Math.max(0.1, clip.end_time - clip.start_time).toFixed(1);
                        const resolvedSrc = toStreamUrl(clip.source_stream_url);
                        const mediaSrc = resolvedSrc
                          ? `${resolvedSrc}#t=${clip.start_time},${clip.end_time}`
                          : null;

                        return (
                          <div
                            key={clip.id}
                            className={`group relative rounded-xl border transition-all flex flex-col bg-slate-950 overflow-hidden ${
                              isSelected
                                ? "border-amber-500/80 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50"
                                : "border-slate-800/80 hover:border-slate-700"
                            }`}
                          >
                            {/* 9:16 Vertical Video Container */}
                            <div className="relative aspect-[9/16] bg-black overflow-hidden flex items-center justify-center">
                              {mediaSrc ? (
                                <video
                                  src={mediaSrc}
                                  controls
                                  preload="metadata"
                                  playsInline
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="text-center p-4 space-y-2">
                                  <Film className="w-8 h-8 text-slate-600 mx-auto" />
                                  <span className="text-[10px] text-slate-500 block">Preview unavailable</span>
                                </div>
                              )}

                              {/* Selection Checkbox Overlay (Top Left) */}
                              <button
                                type="button"
                                onClick={() => toggleClipSelection(clip.id)}
                                className={`absolute top-3 left-3 w-7 h-7 rounded-lg flex items-center justify-center transition shadow-md z-20 ${
                                  isSelected
                                    ? "bg-amber-500 text-slate-950 shadow-amber-500/40"
                                    : "bg-slate-950/70 border border-slate-700 text-transparent hover:border-slate-500 backdrop-blur-sm"
                                }`}
                              >
                                <Check className={`w-4 h-4 stroke-[3] ${isSelected ? "text-slate-950" : "opacity-0"}`} />
                              </button>

                              {/* Score Badge (Top Right) */}
                              <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-gradient-to-r from-amber-500/90 to-orange-600/90 text-slate-950 font-black text-[11px] shadow-md shadow-amber-500/20 flex items-center gap-1 z-20">
                                <Flame className="w-3.5 h-3.5 fill-current" />
                                <span>{clip.virality_score}/100</span>
                              </div>

                              {/* Duration Chip (Bottom Right of Video) */}
                              <div className="absolute bottom-3 right-3 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-slate-300 text-[10px] font-mono border border-white/10 z-20">
                                {duration}s
                              </div>
                            </div>

                            {/* Card Content Footer */}
                            <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2 bg-slate-900/60">
                              <div>
                                <div className="text-xs font-bold text-slate-200 line-clamp-1 group-hover:text-white transition">
                                  {clip.emoji} {clip.rank_title}
                                </div>
                                {clip.hook_sentence && (
                                  <p className="text-[11px] text-slate-400 italic line-clamp-2 mt-1 leading-snug">
                                    "{clip.hook_sentence}"
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px] text-slate-400 font-mono">
                                <span>
                                  {clip.start_time.toFixed(1)}s → {clip.end_time.toFixed(1)}s
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleClipSelection(clip.id)}
                                  className={`font-sans font-bold hover:underline ${
                                    isSelected ? "text-amber-400" : "text-slate-400"
                                  }`}
                                >
                                  {isSelected ? "Selected" : "+ Select"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Action Bar (When 1 or more clips are selected) */}
      {selectedClipIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="bg-slate-900/95 border border-slate-700/80 backdrop-blur-xl rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center text-slate-950 font-black text-sm shadow-md shadow-amber-500/20">
                {selectedClipIds.length}
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  {selectedClipIds.length} Clip{selectedClipIds.length !== 1 ? "s" : ""} Selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedClipIds([])}
                  className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllGlobal}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold transition"
              >
                {selectedClipIds.length === totalClipsCount ? "Deselect All" : "Select All"}
              </button>

              <button
                type="button"
                onClick={handleCreateShortFromSelection}
                disabled={isBuilding}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 hover:from-amber-600 hover:to-rose-700 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-500/25 flex items-center gap-2 transition disabled:opacity-50 cursor-pointer"
              >
                {isBuilding ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Building Short...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 fill-current" />
                    Create Short from Selection
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
