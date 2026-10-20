"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Video,
  ArrowLeft,
  ExternalLink,
  Film,
  Sparkles,
  Search,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Flame,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

interface TranscriptSegmentItem {
  id?: string | number;
  start_time?: number;
  end_time?: number;
  start?: number;
  end?: number;
  text: string;
  speaker?: string;
}

interface ClipItem {
  id: string;
  title: string;
  rank_title?: string;
  start_time?: number;
  end_time?: number;
  start?: number;
  end?: number;
  duration?: number;
  ai_score?: number;
  virality_score?: number;
  hook_sentence?: string;
  emoji?: string;
  category?: string;
  character?: string;
  character_name?: string;
  tags?: string[];
  is_favorite?: boolean;
  is_edited?: boolean;
}

export default function SourceDetailPage() {
  const params = useParams();
  const sourceId = params?.id as string;

  const [source, setSource] = useState<any>(null);
  const [transcript, setTranscript] = useState<TranscriptSegmentItem[]>([]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"transcript" | "clips">("transcript");
  const [isRediscoverOpen, setIsRediscoverOpen] = useState(false);
  const [rediscoverPrompt, setRediscoverPrompt] = useState("");
  const [isRediscovering, setIsRediscovering] = useState(false);
  const [rediscoverError, setRediscoverError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!sourceId) return;

    const fetchAll = async (isInitial = false) => {
      try {
        if (isInitial) setLoading(true);
        const [srcRes, transRes, clipsRes] = await Promise.all([
          fetch(`/api/sources/${sourceId}`),
          fetch(`/api/sources/${sourceId}/transcript`),
          fetch(`/api/sources/${sourceId}/clips`),
        ]);

        if (srcRes.ok) {
          const srcData = await srcRes.json();
          setSource(srcData);
        }
        if (transRes.ok) {
          const transData = await transRes.json();
          setTranscript(transData.segments || []);
        }
        if (clipsRes.ok) {
          const clipsData = await clipsRes.json();
          setClips(clipsData || []);
        }
      } catch (err) {
        console.error("Failed to load source details:", err);
      } finally {
        if (isInitial) setLoading(false);
      }
    };

    fetchAll(true);

    const interval = setInterval(() => {
      fetchAll(false);
    }, 3500);

    return () => clearInterval(interval);
  }, [sourceId]);

  const seekVideo = (seconds: number | undefined | null) => {
    if (seconds === undefined || seconds === null) return;
    const time = typeof seconds === "string" ? parseFloat(seconds) : Number(seconds);
    if (videoRef.current && Number.isFinite(time)) {
      videoRef.current.currentTime = Math.max(0, time);
      videoRef.current.play().catch(() => {});
    }
  };

  const formatTime = (secs: number | undefined | null) => {
    if (secs === undefined || secs === null) return "0:00";
    const t = typeof secs === "string" ? parseFloat(secs) : Number(secs);
    if (!Number.isFinite(t) || t <= 0) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const filteredSegments = transcript.filter((seg) =>
    (seg.text || "").toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  const handleRediscover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rediscoverPrompt.trim()) return;

    setIsRediscovering(true);
    setRediscoverError(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}/rediscover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_prompt: rediscoverPrompt.trim(),
          num_clips: 10,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to re-discover clips.");
      }

      setIsRediscoverOpen(false);
      const [srcRes, clipsRes] = await Promise.all([
        fetch(`/api/sources/${sourceId}`),
        fetch(`/api/sources/${sourceId}/clips`),
      ]);
      if (srcRes.ok) setSource(await srcRes.json());
      if (clipsRes.ok) setClips(await clipsRes.json());
      setActiveTab("clips");
    } catch (err: any) {
      setRediscoverError(err.message || "Failed to re-discover clips.");
    } finally {
      setIsRediscovering(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
        <span className="text-xs">Loading source inspection studio...</span>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-white">Source Video Not Found</h2>
        <Link
          href="/sources"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Sources</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Back button & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/sources"
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-white truncate max-w-2xl">
              {source.title || `Source (${source.id})`}
            </h1>
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-400 mt-0.5">
              <span>{source.category || "General"}</span>
              <span>•</span>
              <span>{formatTime(source.duration || 0)} duration</span>
              <span>•</span>
              <span
                className={`font-semibold capitalize ${
                  source.status === "completed"
                    ? "text-emerald-400"
                    : source.status === "failed"
                    ? "text-rose-400"
                    : "text-amber-400"
                }`}
              >
                {source.current_stage && source.current_stage !== "queued"
                  ? source.current_stage
                  : source.status}
              </span>
              {source.user_prompt && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[11px] font-medium text-indigo-300">
                    <Sparkles className="w-3 h-3 text-indigo-400" />
                    <span>Focus: &quot;{source.user_prompt}&quot;</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setRediscoverPrompt(source?.user_prompt || "");
              setIsRediscoverOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 hover:bg-slate-800/80 text-indigo-300 text-xs font-semibold transition"
            title="Re-run AI highlight discovery with a custom prompt"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Re-discover Focus</span>
          </button>
          {source.youtube_url && (
            <a
              href={source.youtube_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>YouTube</span>
            </a>
          )}
          <Link
            href={`/productions/new?clip_ids=${clips.map((c) => c.id).join(",")}`}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>Create Short From Clips</span>
          </Link>
        </div>
      </div>

      {/* Re-discover Modal Dialog */}
      {isRediscoverOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-white">AI Focus Re-discovery</h3>
              </div>
              <button
                onClick={() => setIsRediscoverOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Target specific characters, themes, or moments using the existing cached transcript. No re-downloading required.
            </p>

            <form onSubmit={handleRediscover} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  AI Focus Directive:
                </label>
                <textarea
                  value={rediscoverPrompt}
                  onChange={(e) => setRediscoverPrompt(e.target.value)}
                  placeholder="e.g. only stewie savage moments, funniest Peter one-liners, intense arguments"
                  rows={3}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono transition"
                  required
                />
              </div>

              {rediscoverError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{rediscoverError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRediscoverOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRediscovering || !rediscoverPrompt.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition"
                >
                  {isRediscovering ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Re-analyzing with AI...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Discover Matching Moments</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Studio Viewport: Left Player, Right Interactive Transcript/Clips */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Native Video Player */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative rounded-2xl bg-black overflow-hidden border border-slate-800 aspect-video shadow-2xl flex items-center justify-center">
            {source.stream_url ? (
              <video
                ref={videoRef}
                src={source.stream_url}
                controls
                className="w-full h-full object-contain"
                playsInline
              />
            ) : (
              <div className="text-center p-8 text-slate-500 text-xs">
                <Video className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <span>Video stream not available on local disk.</span>
              </div>
            )}
          </div>

          {/* Quick Info & Diagnostics */}
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
            <h3 className="font-bold text-slate-200">Diagnostics & Storage</h3>
            <div className="grid grid-cols-2 gap-2 text-slate-400 font-mono text-[11px]">
              <div>Source ID: {source.id}</div>
              <div>Stage: {source.current_stage || source.status}</div>
              <div className="truncate">File: {source.source_path || "N/A"}</div>
              <div>Clips Discovered: {clips.length}</div>
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Interactive Transcript & Clip Browser */}
        <div className="lg:col-span-5 flex flex-col h-[650px] bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Tabs header */}
          <div className="flex items-center justify-between border-b border-slate-800 p-3 bg-slate-950/60 shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("transcript")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === "transcript"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Transcript ({transcript.length})
              </button>
              <button
                onClick={() => setActiveTab("clips")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === "clips"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Clips ({clips.length})
              </button>
            </div>

            {activeTab === "transcript" && (
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-2 w-3 h-3 text-slate-500" />
                <input
                  type="text"
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  placeholder="Filter text..."
                  className="w-full pl-7 pr-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          {/* Content Pane */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {activeTab === "transcript" ? (
              filteredSegments.length === 0 ? (
                <div className="py-20 text-center text-slate-500 text-xs">
                  {transcript.length === 0
                    ? "No transcript segments found for this source."
                    : "No segments match your search."}
                </div>
              ) : (
                filteredSegments.map((seg, idx) => {
                  const startTime = Number.isFinite(Number(seg.start_time))
                    ? Number(seg.start_time)
                    : Number.isFinite(Number(seg.start))
                    ? Number(seg.start)
                    : 0;
                  const endTime = Number.isFinite(Number(seg.end_time))
                    ? Number(seg.end_time)
                    : Number.isFinite(Number(seg.end))
                    ? Number(seg.end)
                    : 0;

                  return (
                    <div
                      key={seg.id ? String(seg.id) : `seg-${idx}`}
                      onClick={() => seekVideo(startTime)}
                      className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-800/40 cursor-pointer transition group"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                        <span className="font-mono text-indigo-400 group-hover:underline">
                          {formatTime(startTime)} - {formatTime(endTime)}
                        </span>
                        {seg.speaker && <span className="text-slate-400">{seg.speaker}</span>}
                      </div>
                      <p className="text-xs text-slate-300 leading-snug group-hover:text-white">
                        {seg.text}
                      </p>
                    </div>
                  );
                })
              )
            ) : (
              /* Discovered Clips */
              clips.length === 0 ? (
                <div className="py-20 text-center text-slate-500 text-xs">
                  No highlight clips extracted yet.
                </div>
              ) : (
                clips.map((clip, idx) => {
                  const startTime = Number.isFinite(Number(clip.start_time))
                    ? Number(clip.start_time)
                    : Number.isFinite(Number(clip.start))
                    ? Number(clip.start)
                    : 0;
                  const endTime = Number.isFinite(Number(clip.end_time))
                    ? Number(clip.end_time)
                    : Number.isFinite(Number(clip.end))
                    ? Number(clip.end)
                    : 0;
                  const duration = Number.isFinite(Number(clip.duration))
                    ? Number(clip.duration)
                    : Math.max(0, Math.round((endTime - startTime) * 100) / 100);

                  return (
                    <div
                      key={clip.id ? String(clip.id) : `clip-${idx}`}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-bold text-slate-200 hover:text-indigo-400 truncate">
                          {clip.emoji || "🔥"} {clip.title || clip.rank_title || `Clip ${idx + 1}`}
                        </h4>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold text-[10px] shrink-0 border border-amber-500/20">
                          <Flame className="w-2.5 h-2.5 fill-current" />
                          <span>{clip.ai_score || clip.virality_score || 0}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <button
                          onClick={() => seekVideo(startTime)}
                          className="font-mono text-indigo-400 hover:underline flex items-center gap-1"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>
                            {formatTime(startTime)} - {formatTime(endTime)} ({duration}s)
                          </span>
                        </button>
                      </div>

                      {clip.hook_sentence && (
                        <p className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                          &quot;{clip.hook_sentence}&quot;
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/80">
                        <Link
                          href={`/clips/edit?ids=${clip.id}`}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition"
                        >
                          Trim & Edit
                        </Link>
                        <Link
                          href={`/productions/new?clip_ids=${clip.id}`}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shadow-sm transition"
                        >
                          Create Short
                        </Link>
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
