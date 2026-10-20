"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Film,
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  Clapperboard,
  Flame,
  Clock,
  Sparkles,
  Loader2,
  Sliders,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

interface ClipDetails {
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
  source_stream_url?: string;
  source_title?: string;
}

function ClipEditorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const returnTo = searchParams.get("returnTo");

  const idsParam = searchParams.get("ids") || "";
  const clipIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [clip, setClip] = useState<ClipDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Editable fields state
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [category, setCategory] = useState("General");
  const [character, setCharacter] = useState("");
  const [hookSentence, setHookSentence] = useState("");
  const [emoji, setEmoji] = useState("🔥");
  const [tags, setTags] = useState("");

  // Video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Fetch current clip data
  useEffect(() => {
    if (clipIds.length === 0) {
      setLoading(false);
      return;
    }

    const currentId = clipIds[currentIndex] || clipIds[0];
    const fetchClip = async () => {
      setLoading(true);
      setErrorMsg(null);
      setSaveSuccess(false);
      try {
        const res = await fetch(`/api/clips/${currentId}`);
        if (!res.ok) throw new Error("Failed to load clip details");
        const data: ClipDetails = await res.json();
        setClip(data);

        // Populate form
        setTitle(data.title || data.original_title || "");
        setStartTime(data.start_time);
        setEndTime(data.end_time);
        setCategory(data.category || "General");
        setCharacter(data.character || data.character_name || "");
        setHookSentence(data.hook_sentence || "");
        setEmoji(data.emoji || "🔥");
        setTags(Array.isArray(data.tags) ? data.tags.join(", ") : "");
      } catch (err: any) {
        setErrorMsg(err.message || "Could not load clip.");
      } finally {
        setLoading(false);
      }
    };

    fetchClip();
  }, [currentIndex, idsParam]);

  // Sync video position to startTime when loaded
  const handleVideoLoaded = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      setCurrentTime(startTime);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const curr = videoRef.current.currentTime;
    setCurrentTime(curr);

    // Loop back if passed endTime
    if (curr >= endTime) {
      videoRef.current.currentTime = startTime;
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (videoRef.current.currentTime < startTime || videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;
      }
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const seekTo = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  const handleSave = async () => {
    if (!clip) return;
    if (endTime <= startTime) {
      setErrorMsg("End time must be greater than start time.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSaveSuccess(false);

    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          start_time: startTime,
          end_time: endTime,
          category,
          character,
          hook_sentence: hookSentence,
          emoji,
          tags: tagList,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update clip.");
      }

      const updated = await res.json();
      setClip(updated.clip);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save clip.");
    } finally {
      setSaving(false);
    }
  };

  const duration = Math.max(0, endTime - startTime);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${s < 10 ? "0" : ""}${s}.${ms}`;
  };

  if (clipIds.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <Film className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-xl font-bold text-white">No Clips Selected For Editing</h2>
        <p className="text-xs text-slate-400">
          Select one or more clips from the Clips Library to trim and edit them in this workspace.
        </p>
        <Link
          href="/clips"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Go to Clips Library</span>
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-24 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
        <span className="text-xs">Loading clip editor workspace...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header & Back Link */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={returnTo || "/clips"}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
            title={returnTo ? "Back to Production" : "Back to Clips Library"}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-white flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-400" />
              <span>Non-Destructive Clip Editor</span>
            </h1>
            <p className="text-xs text-slate-400">
              Zero FFmpeg rendering overhead. Trimming updates timestamp pointers instantly.
            </p>
          </div>
        </div>

        {clip && (
          <div className="flex items-center gap-2">
            <Link
              href={`/productions/new?clip_ids=${clip.id}`}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition"
            >
              <Clapperboard className="w-3.5 h-3.5" />
              <span>Create Short with this Clip</span>
            </Link>
          </div>
        )}
      </div>

      {/* Multi-Clip Switcher Bar (Tabs) */}
      {clipIds.length > 1 && (
        <div className="flex items-center gap-2 p-2 bg-slate-900/90 border border-slate-800 rounded-2xl overflow-x-auto">
          <span className="text-[11px] font-bold text-slate-400 px-2 shrink-0">
            Editing Batch ({currentIndex + 1} of {clipIds.length}):
          </span>
          {clipIds.map((id, idx) => (
            <button
              key={id}
              onClick={() => setCurrentIndex(idx)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition ${
                currentIndex === idx
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              <span>#{idx + 1}</span>
              <span className="truncate max-w-[120px]">
                {currentIndex === idx && clip ? clip.title : id.slice(0, 10)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main Studio Editor: Left 9:16 Video Player, Right Metadata Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (5 cols): 9:16 Player Simulation & Trim Slider */}
        <div className="lg:col-span-5 space-y-4">
          <div className="relative mx-auto w-full max-w-[340px] aspect-[9/16] bg-black rounded-3xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
            {clip?.source_stream_url ? (
              <video
                ref={videoRef}
                src={clip.source_stream_url}
                className="w-full h-full object-cover"
                playsInline
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlay}
              />
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">
                <Film className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <span>Source stream not available</span>
              </div>
            )}

            {/* Play/Pause overlay */}
            <button
              onClick={togglePlay}
              className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${
                isPlaying ? "opacity-0 hover:opacity-100" : "opacity-100"
              }`}
            >
              <div className="p-4 rounded-full bg-indigo-600 text-white shadow-2xl shadow-indigo-600/50">
                {isPlaying ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current translate-x-0.5" />
                )}
              </div>
            </button>

            {/* Current playback time badge */}
            <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-[11px] font-mono text-slate-300 border border-slate-800">
              {formatTime(currentTime)}
            </div>

            {/* Virality badge */}
            <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-amber-500/20 flex items-center gap-1">
              <Flame className="w-3 h-3 fill-current" />
              <span>{clip?.ai_score || clip?.virality_score || 90}</span>
            </div>
          </div>

          {/* Quick Playback & Seek Buttons */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => seekTo(startTime)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Seek to Start
            </button>
            <button
              onClick={togglePlay}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition"
            >
              {isPlaying ? "Pause" : "Play Range"}
            </button>
            <button
              onClick={() => seekTo(endTime - 2)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Seek to End
            </button>
          </div>
        </div>

        {/* Right Column (7 cols): Metadata & Trim Range Sliders */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-5">
            {/* Title & Emoji */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Clip Title & Emoji
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  className="w-16 px-3 py-2 text-center text-lg bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  title="Clip Emoji"
                />
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="flex-1 px-4 py-2 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white font-bold placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. PETER'S BIGGEST MISTAKE"
                  required
                />
              </div>
            </div>

            {/* Trimming Controls: Start & End Timestamps */}
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Trim Boundary (Seconds)</span>
                </span>
                <span className="text-xs font-mono font-bold text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
                  Duration: {duration.toFixed(1)}s
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    Start Time (s)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={startTime}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStartTime(val);
                      seekTo(val);
                    }}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                    End Time (s)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={endTime}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setEndTime(val);
                      seekTo(val);
                    }}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Slider simulation */}
              <div className="space-y-1">
                <input
                  type="range"
                  min="0"
                  max={Math.max(endTime + 30, 120)}
                  step="0.5"
                  value={startTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val < endTime) {
                      setStartTime(val);
                      seekTo(val);
                    }
                  }}
                  className="w-full accent-indigo-500"
                />
              </div>
            </div>

            {/* Category & Character */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Category
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Character Name
                </label>
                <input
                  type="text"
                  value={character}
                  onChange={(e) => setCharacter(e.target.value)}
                  placeholder="e.g. Peter Griffin, Phil Dunphy"
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Hook Sentence */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Hook Sentence / Teaser
              </label>
              <textarea
                value={hookSentence}
                onChange={(e) => setHookSentence(e.target.value)}
                placeholder="Catchy opening sentence or reason this moment went viral..."
                rows={2}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Tags <span className="text-slate-500">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="funny, viral, stewie, roast"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Feedback Alerts */}
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {saveSuccess && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Saved clip metadata instantly! (Zero rendering required)</span>
              </div>
            )}

            {/* Save Button */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <span className="text-[11px] text-slate-500">
                Non-destructive: original video file untouched.
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition hover:scale-105"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Metadata...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClipEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-24 flex justify-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <ClipEditorContent />
    </Suspense>
  );
}
