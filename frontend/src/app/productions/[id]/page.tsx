"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Clapperboard,
  ArrowLeft,
  Play,
  Pause,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Sliders,
  Type,
  CheckCircle2,
  AlertCircle,
  Clock,
  Flame,
  Tv,
  Loader2,
  Save,
  Film,
  Download,
  ExternalLink,
  X,
  Search,
  Edit3,
  ArrowDownUp,
} from "lucide-react";

interface ProductionClipItem {
  id?: string;
  production_clip_id?: string;
  clip_id: string;
  sequence_index?: number;
  position?: number;
  custom_start?: number;
  custom_end?: number;
  custom_title?: string;
  start_time?: number;
  end_time?: number;
  start_override?: number;
  end_override?: number;
  duration: number;
  title?: string;
  emoji?: string;
  category?: string;
  thumbnail_url?: string;
  source_stream_url?: string;
  clip?: {
    id: string;
    title: string;
    start_time: number;
    end_time: number;
    emoji?: string;
    category?: string;
    character?: string;
    source_stream_url?: string;
    thumbnail_url?: string;
    ai_score?: number;
  };
}

interface ProductionData {
  id: string;
  title: string;
  name?: string;
  template: string;
  aspect_ratio: string;
  layout_mode: string;
  transition_type: string;
  countdown_order?: boolean;
  font_family?: string;
  channel_handle?: string;
  caption_settings?: any;
  youtube_title?: string;
  youtube_description?: string;
  youtube_tags?: any;
  status: string;
  render_progress?: string;
  render_error?: string;
  render_id?: string;
  clips: ProductionClipItem[];
  total_duration: number;
}

export default function ProductionStudioPage() {
  const params = useParams();
  const productionId = params?.id as string;

  const [production, setProduction] = useState<ProductionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("ranking");
  const [layoutMode, setLayoutMode] = useState("1:1");
  const [transitionType, setTransitionType] = useState("swoosh");
  const [countdownOrder, setCountdownOrder] = useState(true);
  const [fontFamily, setFontFamily] = useState("anton");
  const [channelHandle, setChannelHandle] = useState("");
  const [captionAnimation, setCaptionAnimation] = useState("karaoke");
  const [captionColor, setCaptionColor] = useState("&H00FFFF&");
  const [captionFont, setCaptionFont] = useState("dejavu");
  const [captionSize, setCaptionSize] = useState("54");
  const [clips, setClips] = useState<ProductionClipItem[]>([]);

  // YouTube Metadata state
  const [ytTitle, setYtTitle] = useState("");
  const [ytDescription, setYtDescription] = useState("");
  const [ytTags, setYtTags] = useState("");

  // Add Clips Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [repoClips, setRepoClips] = useState<any[]>([]);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [previewClip, setPreviewClip] = useState<ProductionClipItem | null>(null);

  const fetchProduction = useCallback(async () => {
    try {
      const res = await fetch(`/api/productions/${productionId}`);
      if (!res.ok) throw new Error("Failed to load production.");
      const data: ProductionData = await res.json();
      setProduction(data);

      setTitle(data.title || data.name || "");
      setTemplate(data.template || "ranking");
      setLayoutMode(data.layout_mode || "1:1");
      setTransitionType(data.transition_type || "swoosh");
      setCountdownOrder(data.countdown_order !== undefined ? Boolean(data.countdown_order) : true);
      setFontFamily(data.font_family || "anton");
      setChannelHandle(data.channel_handle || "");
      if (data.caption_settings) {
        if (data.caption_settings.animation) setCaptionAnimation(data.caption_settings.animation);
        if (data.caption_settings.primary_color) setCaptionColor(data.caption_settings.primary_color);
        if (data.caption_settings.font || data.caption_settings.caption_font) {
          setCaptionFont(data.caption_settings.font || data.caption_settings.caption_font);
        }
        if (data.caption_settings.size || data.caption_settings.caption_size) {
          setCaptionSize(data.caption_settings.size || data.caption_settings.caption_size);
        }
      }
      setClips(data.clips || []);

      setYtTitle(data.youtube_title || "");
      setYtDescription(data.youtube_description || "");
      setYtTags(
        Array.isArray(data.youtube_tags)
          ? data.youtube_tags.join(", ")
          : typeof data.youtube_tags === "string"
          ? data.youtube_tags
          : ""
      );

      if (data.status === "rendering") {
        setRendering(true);
      } else {
        setRendering(false);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Could not load production.");
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => {
    fetchProduction();
  }, [fetchProduction]);

  // Polling when rendering
  useEffect(() => {
    if (!rendering) return;
    const interval = setInterval(fetchProduction, 2500);
    return () => clearInterval(interval);
  }, [rendering, fetchProduction]);

  const handleSaveChanges = async () => {
    setSaving(true);
    setErrorMsg(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/productions/${productionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          template,
          layout_mode: layoutMode,
          transition_type: transitionType,
          countdown_order: countdownOrder,
          font_family: fontFamily,
          channel_handle: channelHandle.trim(),
          caption_settings: {
            animation: captionAnimation,
            primary_color: captionColor,
            font: captionFont,
            size: captionSize,
            captions_enabled: captionAnimation !== "none",
          },
          youtube_title: ytTitle,
          youtube_description: ytDescription,
          youtube_tags: ytTags
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0),
          clips: clips.map((c, idx) => ({
            clip_id: c.clip_id,
            sequence_index: idx,
            custom_start: c.custom_start,
            custom_end: c.custom_end,
            custom_title: c.custom_title,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to save production.");
      }

      const updated = await res.json();
      setProduction(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save production.");
    } finally {
      setSaving(false);
    }
  };

  const handleRenderShort = async () => {
    // Save first to ensure latest sequence is rendered
    await handleSaveChanges();

    setRendering(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/productions/${productionId}/render`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Render failed to start.");
      }

      fetchProduction();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to trigger render.");
      setRendering(false);
    }
  };

  const handleGenerateMetadata = async () => {
    setGeneratingAi(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/productions/${productionId}/generate-metadata`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to generate metadata.");
      }

      const data = await res.json();
      if (data.youtube_title) setYtTitle(data.youtube_title);
      if (data.youtube_description) setYtDescription(data.youtube_description);
      if (data.youtube_tags) {
        setYtTags(
          Array.isArray(data.youtube_tags) ? data.youtube_tags.join(", ") : data.youtube_tags
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate metadata.");
    } finally {
      setGeneratingAi(false);
    }
  };

  // Reordering helpers
  const moveClip = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= clips.length) return;

    const copy = [...clips];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIndex, 0, moved);
    setClips(copy);
  };

  const removeClip = (index: number) => {
    const copy = clips.filter((_, idx) => idx !== index);
    setClips(copy);
  };

  // Add clips from modal
  const openAddModal = async () => {
    setIsAddModalOpen(true);
    setRepoLoading(true);
    try {
      const res = await fetch("/api/clips?limit=50");
      if (res.ok) {
        const data = await res.json();
        setRepoClips(data.items || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRepoLoading(false);
    }
  };

  const addClipToProduction = (c: any) => {
    const newProductionClip: ProductionClipItem = {
      id: `temp_${Date.now()}_${c.id}`,
      clip_id: c.id,
      sequence_index: clips.length,
      custom_start: c.start_time,
      custom_end: c.end_time,
      custom_title: c.title,
      duration: c.duration,
      clip: {
        id: c.id,
        title: c.title,
        start_time: c.start_time,
        end_time: c.end_time,
        emoji: c.emoji,
        category: c.category,
        character: c.character,
        source_stream_url: c.source_stream_url,
        ai_score: c.ai_score,
      },
    };

    setClips((prev) => [...prev, newProductionClip]);
  };

  // Calculate total duration
  const totalDuration = clips.reduce((acc, c) => {
    const dur =
      c.custom_start !== undefined && c.custom_end !== undefined
        ? Math.max(0, c.custom_end - c.custom_start)
        : c.duration || 0;
    return acc + dur;
  }, 0);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-24 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
        <span className="text-xs">Loading production studio...</span>
      </div>
    );
  }

  if (!production) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-white">Production Not Found</h2>
        <Link
          href="/productions"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Productions</span>
        </Link>
      </div>
    );
  }

  const isRendered = production.status === "rendered";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-32">
      {/* Studio Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/productions"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              <Clapperboard className="w-5 h-5 text-indigo-400" />
              <span>{title || "Shorts Production Studio"}</span>
            </h1>
            <p className="text-xs text-slate-400">
              Sequence clips, pick modular template renderer, and render with deterministic SHA-256 caching.
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveChanges}
            disabled={saving || rendering}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold transition border border-slate-700"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save Draft</span>
          </button>

          <button
            onClick={handleRenderShort}
            disabled={rendering || clips.length === 0}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition hover:scale-105"
          >
            {rendering ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Rendering...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Render Short</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Render Status Banner if rendering or error */}
      {rendering && (
        <div className="p-4 rounded-2xl bg-indigo-950/60 border border-indigo-500/40 text-indigo-300 text-xs space-y-2 shadow-xl animate-pulse">
          <div className="flex items-center justify-between font-bold">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Rendering Short In Progress</span>
            </span>
            <span>{production.render_progress || "Processing clips & transitions..."}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      )}

      {isRendered && (
        <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <span className="font-bold block">Render Ready!</span>
              <span className="text-[11px] text-emerald-400/80">
                Your deterministic MP4 is fully compiled and cached.
              </span>
            </div>
          </div>
          <Link
            href="/renders"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Open in Renders</span>
          </Link>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Production draft saved successfully!</span>
        </div>
      )}

      {/* Main Studio Viewport (2 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (7 cols): Clip Sequencing & Timeline */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-indigo-400" />
                  <span>Clip Sequence & Ordering</span>
                </h2>
                <p className="text-xs text-slate-400">
                  {countdownOrder
                    ? `Clips play in reverse countdown order from #${clips.length} down to #1.`
                    : `Clips play in ascending ranking order from #1 up to #${clips.length}.`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {clips.length > 1 && (
                  <button
                    onClick={() => setClips([...clips].reverse())}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700/80 transition"
                    title="Reverse sequence order of clips"
                  >
                    <ArrowDownUp className="w-3.5 h-3.5 text-slate-400" />
                    <span>Flip Order</span>
                  </button>
                )}
                <button
                  onClick={openAddModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 text-xs font-bold border border-indigo-500/30 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Clips</span>
                </button>
              </div>
            </div>

            {/* Clips Sequence List */}
            {clips.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-slate-950/60 border border-slate-800 text-slate-500 text-xs space-y-3">
                <Film className="w-8 h-8 mx-auto opacity-30 text-indigo-400" />
                <p>No clips added to this production yet.</p>
                <button
                  onClick={openAddModal}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-500"
                >
                  Browse Clip Library
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {clips.map((item, idx) => {
                  const rankNumber = countdownOrder ? clips.length - idx : idx + 1;
                  const itemDur =
                    item.custom_start !== undefined && item.custom_end !== undefined
                      ? (item.custom_end - item.custom_start).toFixed(1)
                      : item.duration?.toFixed(1) || "0";

                  return (
                    <div
                      key={item.id || idx}
                      className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between gap-3 group"
                    >
                      {/* Rank Index & Drag order */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-black text-xs flex items-center justify-center shrink-0">
                          #{rankNumber}
                        </div>

                        {/* Thumbnail with Play preview button */}
                        <div className="relative w-16 h-12 rounded-xl bg-zinc-950 overflow-hidden shrink-0 border border-zinc-800 group/thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.thumbnail_url || item.clip?.thumbnail_url || `/api/clips/${item.clip_id}/thumbnail`}
                            alt={item.title || item.custom_title || item.clip?.title || "Thumbnail"}
                            className="w-full h-full object-cover transition group-hover/thumb:scale-105"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setPreviewClip(item)}
                            className="absolute inset-0 m-auto z-10 w-7 h-7 rounded-full bg-zinc-950/80 hover:bg-zinc-900 text-white shadow-md border border-zinc-700/80 flex items-center justify-center transition hover:scale-110 active:scale-95"
                            title="Preview Clip"
                          >
                            <Play className="w-3 h-3 fill-current translate-x-0.5 text-zinc-100" />
                          </button>
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <input
                            type="text"
                            value={item.custom_title || item.title || item.clip?.title || ""}
                            onChange={(e) => {
                              const updated = [...clips];
                              updated[idx].custom_title = e.target.value;
                              setClips(updated);
                            }}
                            className="w-full text-xs font-bold text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none transition py-0.5"
                            placeholder="Clip Title..."
                          />

                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                            <span>Duration: {itemDur}s</span>
                            <span>•</span>
                            <span className="text-slate-400">
                              {item.category || item.clip?.category || "General"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions: Edit in Clip Editor, Move Up/Down, Remove */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link
                          href={`/clips/edit?ids=${item.clip_id}&returnTo=/productions/${productionId}`}
                          className="p-1.5 px-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition flex items-center gap-1.5 text-xs font-medium border border-zinc-700/60"
                          title="Re-edit in Non-Destructive Clip Editor"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-zinc-400" />
                          <span className="hidden sm:inline">Edit</span>
                        </Link>

                        <button
                          onClick={() => moveClip(idx, "up")}
                          disabled={idx === 0}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-white transition"
                          title="Move up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveClip(idx, "down")}
                          disabled={idx === clips.length - 1}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-white transition"
                          title="Move down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeClip(idx)}
                          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
                          title="Remove clip"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Total Duration Readout & Warning */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-slate-400">Total Short Duration:</span>
                <span className="font-bold text-white font-mono">
                  {formatDuration(totalDuration)} ({totalDuration.toFixed(1)}s)
                </span>
              </div>

              {totalDuration > 60 && (
                <span className="text-[11px] font-semibold text-amber-400">
                  Note: YouTube Shorts recommendation is ≤ 60s
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Template Settings & AI Metadata Assistant */}
        <div className="lg:col-span-5 space-y-6">
          {/* Production Settings Card */}
          <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span>Production Settings</span>
            </h3>

            {/* Header Title */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Header Title (Banner Overlay)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. TOP VIRAL MOMENTS"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white font-bold focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Template Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Modular Template Engine
              </label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ranking">RankingTemplate (Countdown #N..#1, reveal, swoosh)</option>
                <option value="single_title">SingleTitleTemplate (Persistent header banner)</option>
              </select>
            </div>

            {/* Video Layout Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Layout Mode
                </label>
                <select
                  value={layoutMode}
                  onChange={(e) => setLayoutMode(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="1:1">1:1 Square Center</option>
                  <option value="9:16">9:16 Full Crop</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Transition
                </label>
                <select
                  value={transitionType}
                  onChange={(e) => setTransitionType(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="swoosh">Swoosh Audio & Reveal</option>
                  <option value="black_screen">Black Cut with core.mp3</option>
                  <option value="crossfade">Crossfade</option>
                  <option value="cut">Direct Cut</option>
                </select>
              </div>

              {template === "ranking" && (
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Rank Numbering Direction
                  </label>
                  <select
                    value={countdownOrder ? "countdown" : "ascending"}
                    onChange={(e) => setCountdownOrder(e.target.value === "countdown")}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="countdown">Countdown (#5 → #1, Reverse Order - Classic Viral)</option>
                    <option value="ascending">Ascending (#1 → #5, Forward Order)</option>
                  </select>
                </div>
              )}

              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Font & Typography Style
                </label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="anton">Meme / Bold Impact (Anton - Sheared Viral Style)</option>
                  <option value="minimal">Minimal Sans (Inter - Clean Modern)</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                  <span>Channel Tag / Watermark (@handle)</span>
                  <span className="text-[10px] text-slate-500 font-normal">Shows at bottom of video</span>
                </label>
                <input
                  type="text"
                  value={channelHandle}
                  onChange={(e) => setChannelHandle(e.target.value)}
                  placeholder="@malshorts"
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            {/* Subtitles & Captions */}
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-3">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-indigo-400" />
                <span>Captions Preset</span>
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Caption Font</label>
                  <select
                    value={captionFont}
                    onChange={(e) => setCaptionFont(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    <option value="dejavu">Classic V1 Style (DejaVu Sans - From Screenshot)</option>
                    <option value="anton">Meme Style (Anton - Bold Impact)</option>
                    <option value="montserrat">Viral Heavy (Montserrat Black)</option>
                    <option value="inter">Modern Clean (Inter Bold)</option>
                    <option value="liberation">Standard Bold (Liberation Sans)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Font Size</label>
                  <select
                    value={captionSize}
                    onChange={(e) => setCaptionSize(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    <option value="54">V1 Classic (54pt - Exact Match)</option>
                    <option value="60">Medium (60pt)</option>
                    <option value="70">Large (70pt)</option>
                    <option value="80">Extra Large (80pt)</option>
                    <option value="46">Compact (46pt)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Animation</label>
                  <select
                    value={captionAnimation}
                    onChange={(e) => setCaptionAnimation(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="karaoke">Karaoke Word Highlight</option>
                    <option value="pop">Pop-in Word</option>
                    <option value="clean">Static Subtitles</option>
                    <option value="none">Disabled (No Subtitles)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Primary Color</label>
                  <select
                    value={captionColor}
                    onChange={(e) => setCaptionColor(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="&H00FFFF&">Yellow Highlight</option>
                    <option value="&H00FF00&">Green Highlight</option>
                    <option value="&HFFFFFF&">Pure White</option>
                    <option value="&H00A5FF&">Orange Highlight</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* YouTube AI Metadata Assistant Card */}
          <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>YouTube Metadata Assistant</span>
              </h3>

              <button
                type="button"
                onClick={handleGenerateMetadata}
                disabled={generatingAi}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-semibold border border-amber-500/20 transition"
              >
                {generatingAi ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>Generate AI Title</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Suggested YouTube Video Title
              </label>
              <input
                type="text"
                value={ytTitle}
                onChange={(e) => setYtTitle(e.target.value)}
                placeholder="AI-generated viral YouTube Short title..."
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
              <textarea
                value={ytDescription}
                onChange={(e) => setYtDescription(e.target.value)}
                placeholder="Video description with hashtags..."
                rows={3}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Tags <span className="text-slate-500">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={ytTags}
                onChange={(e) => setYtTags(e.target.value)}
                placeholder="shorts, viral, family guy, comedy"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Add Clips Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Add Clips to Sequence</h3>
                <p className="text-xs text-slate-400">Click &quot;+ Add&quot; to append any clip to your Short</p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search clips repository..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Clips List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {repoLoading ? (
                <div className="py-12 flex justify-center text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : repoClips.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">No clips found.</div>
              ) : (
                repoClips
                  .filter((c) =>
                    c.title.toLowerCase().includes(repoSearch.toLowerCase()) ||
                    (c.category || "").toLowerCase().includes(repoSearch.toLowerCase())
                  )
                  .map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-200 truncate">
                          {c.emoji} {c.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>{c.duration}s</span>
                          <span>•</span>
                          <span>Score: {c.ai_score || c.virality_score}</span>
                          <span>•</span>
                          <span>{c.category}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => addClipToProduction(c)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition shrink-0"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add</span>
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Preview Modal */}
      {previewClip && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100 truncate flex-1 pr-2">
                {previewClip.emoji || previewClip.clip?.emoji || "🎬"} {previewClip.custom_title || previewClip.title || previewClip.clip?.title}
              </h3>
              <button
                onClick={() => setPreviewClip(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Player */}
            <div className="relative aspect-[9/16] bg-black flex items-center justify-center">
              {previewClip.source_stream_url || previewClip.clip?.source_stream_url ? (
                <video
                  src={previewClip.source_stream_url || previewClip.clip?.source_stream_url}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    const startT = previewClip.start_override ?? previewClip.custom_start ?? previewClip.start_time ?? previewClip.clip?.start_time ?? 0;
                    vid.currentTime = startT;
                  }}
                  onTimeUpdate={(e) => {
                    const vid = e.currentTarget;
                    const startT = previewClip.start_override ?? previewClip.custom_start ?? previewClip.start_time ?? previewClip.clip?.start_time ?? 0;
                    const endT = previewClip.end_override ?? previewClip.custom_end ?? previewClip.end_time ?? previewClip.clip?.end_time ?? vid.duration;
                    if (vid.currentTime >= endT) {
                      vid.currentTime = startT;
                    }
                  }}
                />
              ) : (
                <span className="text-xs text-zinc-500">Video stream not available</span>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-zinc-800 flex items-center justify-between bg-zinc-950">
              <span className="text-xs font-mono text-zinc-400">
                {(previewClip.duration || 0).toFixed(1)}s ({formatDuration(previewClip.start_override ?? previewClip.start_time ?? 0)} - {formatDuration(previewClip.end_override ?? previewClip.end_time ?? 0)})
              </span>
              <Link
                href={`/clips/edit?ids=${previewClip.clip_id}&returnTo=/productions/${productionId}`}
                className="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-xs transition flex items-center gap-1.5 shadow-sm"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Re-edit in Clip Editor</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

