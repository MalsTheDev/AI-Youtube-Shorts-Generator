"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Film,
  Search,
  Star,
  Flame,
  Play,
  CheckSquare,
  Square,
  Trash2,
  Edit3,
  Clapperboard,
  Loader2,
  X,
  Plus,
  Video,
  UploadCloud,
} from "lucide-react";

interface ClipItem {
  id: string;
  source_id: string;
  title: string;
  original_title: string;
  start_time: number;
  end_time: number;
  duration: number;
  ai_score: number;
  virality_score: number;
  hook_sentence?: string;
  emoji?: string;
  category?: string;
  character?: string;
  character_name?: string;
  tags?: string[];
  is_favorite: boolean;
  is_edited: boolean;
  is_archived: boolean;
  source_stream_url?: string;
  thumbnail_url?: string;
  source_title?: string;
  used_in_productions_count?: number;
  created_at?: string;
}

export default function ClipsPage() {
  const router = useRouter();

  const [clips, setClips] = useState<ClipItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [category, setCategory] = useState("all");
  const [character, setCharacter] = useState("all");
  const [categories, setCategories] = useState<string[]>([]);
  const [sort, setSort] = useState("score_desc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Preview modal state
  const [previewClip, setPreviewClip] = useState<ClipItem | null>(null);

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (activeFilter !== "all") params.set("filter", activeFilter);
      if (category !== "all") params.set("category", category);
      if (character !== "all") params.set("character", character);
      if (sort) params.set("sort", sort);
      params.set("limit", "150");

      const res = await fetch(`/api/clips?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load clips");
      const data = await res.json();
      setClips(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error("Failed to load clips:", err);
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter, category, character, sort]);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  const toggleSelectClip = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === clips.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(clips.map((c) => c.id));
    }
  };

  const toggleFavorite = async (clip: ClipItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextVal = !clip.is_favorite;

    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, is_favorite: nextVal } : c))
    );

    try {
      await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorite: nextVal }),
      });
    } catch (err) {
      console.error(err);
      fetchClips();
    }
  };

  const handleBulkFavorite = async () => {
    if (selectedIds.length === 0) return;
    try {
      await fetch("/api/clips/bulk-favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_ids: selectedIds, is_favorite: true }),
      });
      fetchClips();
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to archive/delete ${selectedIds.length} clips?`)) return;
    try {
      await fetch("/api/clips/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip_ids: selectedIds, permanent: false }),
      });
      fetchClips();
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const filterTabs = [
    { id: "all", label: "All Clips" },
    { id: "new", label: "New (Unused)" },
    { id: "favorites", label: "Favorites" },
    { id: "edited", label: "Edited" },
    { id: "used", label: "Used in Short" },
    { id: "archived", label: "Archived" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 pb-28">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Film className="w-5 h-5 text-zinc-300" />
            <span>Clips Asset Library</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Independent, reusable clip repository. Use clips across multiple Shorts productions without re-rendering.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/sources"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-medium transition"
          >
            <Video className="w-3.5 h-3.5" />
            <span>Manage Sources</span>
          </Link>
          <Link
            href="/productions/new"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Compose Short</span>
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-zinc-800/80">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              activeFilter === tab.id
                ? "bg-zinc-800 text-white font-semibold"
                : "text-zinc-400 hover:text-white hover:bg-zinc-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search & Sort Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, character, hook..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
        </div>

        {/* Category filter */}
        <div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-600"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-600"
          >
            <option value="score_desc">AI Virality (High to Low)</option>
            <option value="score_asc">AI Virality (Low to High)</option>
            <option value="date_desc">Newest First</option>
            <option value="date_asc">Oldest First</option>
            <option value="duration_asc">Shortest First</option>
            <option value="duration_desc">Longest First</option>
            <option value="title_asc">Title (A-Z)</option>
          </select>
        </div>

        {/* Multi-select toggle */}
        <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-400">
          <span>{total} clips available</span>
          <button
            onClick={selectAll}
            className="font-semibold text-zinc-200 hover:text-white"
          >
            {selectedIds.length === clips.length && clips.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      {/* Clips Grid */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center text-zinc-500">
          <Loader2 className="w-7 h-7 animate-spin mb-3 text-zinc-400" />
          <span className="text-xs">Loading clips library...</span>
        </div>
      ) : clips.length === 0 ? (
        <div className="p-16 text-center rounded-2xl bg-zinc-900/40 border border-zinc-800 text-zinc-500 text-xs space-y-3">
          <Film className="w-10 h-10 mx-auto opacity-30 text-zinc-400" />
          <p>No clips found matching your filters.</p>
          <button
            onClick={() => {
              setSearch("");
              setActiveFilter("all");
              setCategory("all");
            }}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 font-semibold text-xs hover:bg-zinc-700"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {clips.map((clip) => {
            const isSelected = selectedIds.includes(clip.id);

            return (
              <div
                key={clip.id}
                onClick={() => toggleSelectClip(clip.id)}
                className={`group relative rounded-2xl bg-zinc-900 border transition shadow-sm cursor-pointer flex flex-col overflow-hidden ${
                  isSelected
                    ? "border-zinc-400 ring-1 ring-zinc-400"
                    : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                {/* 16:10 Thumbnail Header */}
                <div className="relative aspect-[16/10] bg-zinc-950 overflow-hidden shrink-0 border-b border-zinc-800 group/thumb">
                  {/* Actual Thumbnail Image with on-demand fallback */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={clip.thumbnail_url || `/api/clips/${clip.id}/thumbnail`}
                    alt={clip.title}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />

                  {/* Subtle dark gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-black/30 pointer-events-none" />

                  {/* Select Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectClip(clip.id);
                    }}
                    className="absolute top-2 left-2 z-20 p-1 rounded-md bg-zinc-950/80 text-white backdrop-blur-sm transition hover:bg-zinc-800"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-zinc-100 fill-zinc-800" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                  </button>

                  {/* Favorite Star */}
                  <button
                    type="button"
                    onClick={(e) => toggleFavorite(clip, e)}
                    className="absolute top-2 right-2 z-20 p-1 rounded-md bg-zinc-950/80 text-zinc-400 hover:text-amber-400 backdrop-blur-sm transition"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        clip.is_favorite
                          ? "text-amber-400 fill-amber-400"
                          : "text-zinc-400"
                      }`}
                    />
                  </button>

                  {/* Play preview button - centered and clearly visible */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewClip(clip);
                    }}
                    className="absolute inset-0 m-auto z-20 w-11 h-11 rounded-full bg-zinc-950/80 hover:bg-zinc-900 text-white shadow-xl border border-zinc-700/80 flex items-center justify-center opacity-90 group-hover:opacity-100 group-hover:scale-110 active:scale-95 transition"
                    title="Quick Preview Clip"
                  >
                    <Play className="w-4 h-4 fill-current translate-x-0.5 text-zinc-100" />
                  </button>

                  {/* Virality score badge */}
                  <div className="absolute bottom-2 left-2 z-20 px-1.5 py-0.5 rounded bg-zinc-950/90 text-[10px] font-bold text-zinc-200 border border-zinc-800 flex items-center gap-1 font-mono">
                    <Flame className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                    <span>{clip.ai_score || clip.virality_score}</span>
                  </div>

                  {/* Duration badge */}
                  <div className="absolute bottom-2 right-2 z-20 px-1.5 py-0.5 rounded bg-zinc-950/90 text-[10px] font-mono text-zinc-300 border border-zinc-800">
                    {clip.duration}s
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-zinc-100 group-hover:text-white line-clamp-2">
                      {clip.emoji} {clip.title}
                    </h3>

                    {clip.hook_sentence && (
                      <p className="text-[11px] text-zinc-400 italic line-clamp-1">
                        &quot;{clip.hook_sentence}&quot;
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-800/80">
                    <div className="flex flex-wrap items-center justify-between text-[10px] text-zinc-500">
                      <span className="font-mono text-zinc-400">
                        {formatTime(clip.start_time)} - {formatTime(clip.end_time)}
                      </span>
                      {clip.category && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium">
                          {clip.category}
                        </span>
                      )}
                    </div>

                    {/* Usage count badge */}
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-zinc-500">
                        {clip.used_in_productions_count && clip.used_in_productions_count > 0 ? (
                          <span className="text-emerald-400 font-medium">
                            Used in {clip.used_in_productions_count} short(s)
                          </span>
                        ) : (
                          <span className="text-zinc-500">Unused</span>
                        )}
                      </span>
                      {clip.is_edited && (
                        <span className="text-zinc-400 font-medium">Edited</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-1 pt-1">
                      <Link
                        href={`/clips/edit?ids=${clip.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-center py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium transition"
                      >
                        Trim & Edit
                      </Link>
                      <Link
                        href={`/productions/new?clip_ids=${clip.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-center py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-semibold transition"
                      >
                        + Short
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Multi-Select Floating Sticky Bottom Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-xl bg-zinc-900/95 border border-zinc-700 backdrop-blur-md rounded-2xl p-2.5 shadow-2xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2 pl-2">
            <span className="w-5 h-5 rounded-full bg-zinc-100 text-zinc-950 text-[11px] font-bold flex items-center justify-center">
              {selectedIds.length}
            </span>
            <span className="text-xs font-semibold text-white">selected</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href={`/productions/new?clip_ids=${selectedIds.join(",")}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-bold transition"
            >
              <Clapperboard className="w-3.5 h-3.5" />
              <span>Create Short</span>
            </Link>

            <Link
              href={`/clips/edit?ids=${selectedIds.join(",")}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Batch Edit</span>
            </Link>

            <button
              onClick={handleBulkFavorite}
              className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-400 transition"
              title="Add all to favorites"
            >
              <Star className="w-3.5 h-3.5 fill-current" />
            </button>

            <button
              onClick={handleBulkDelete}
              className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-rose-400 transition"
              title="Archive selected clips"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setSelectedIds([])}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white transition"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Video Preview Modal */}
      {previewClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white truncate max-w-[200px]">
                {previewClip.emoji} {previewClip.title}
              </h3>
              <button
                onClick={() => setPreviewClip(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative aspect-[9/16] bg-black rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center">
              {previewClip.source_stream_url ? (
                <video
                  src={previewClip.source_stream_url}
                  autoPlay
                  controls
                  className="w-full h-full object-cover"
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    vid.currentTime = previewClip.start_time;
                  }}
                  onTimeUpdate={(e) => {
                    const vid = e.currentTarget;
                    if (vid.currentTime >= previewClip.end_time) {
                      vid.currentTime = previewClip.start_time;
                    }
                  }}
                />
              ) : (
                <span className="text-xs text-zinc-500">Video preview not available</span>
              )}
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="font-mono text-zinc-400 text-[11px]">
                {previewClip.duration}s ({formatTime(previewClip.start_time)} - {formatTime(previewClip.end_time)})
              </span>
              <Link
                href={`/clips/edit?ids=${previewClip.id}`}
                className="text-xs font-semibold text-zinc-200 hover:underline"
              >
                Open Editor →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
