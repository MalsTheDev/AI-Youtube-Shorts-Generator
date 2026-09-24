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
} from "lucide-react";

interface TranscriptSegmentItem {
  id: string;
  start_time: number;
  end_time: number;
  text: string;
  speaker?: string;
}

interface ClipItem {
  id: string;
  title: string;
  rank_title?: string;
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

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!sourceId) return;

    const fetchAll = async () => {
      try {
        setLoading(true);
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
        setLoading(false);
      }
    };

    fetchAll();
  }, [sourceId]);

  const seekVideo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const filteredSegments = transcript.filter((seg) =>
    seg.text.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

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
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
              <span>{source.category || "General"}</span>
              <span>•</span>
              <span>{formatTime(source.duration || 0)} duration</span>
              <span>•</span>
              <span className="capitalize text-emerald-400 font-semibold">{source.status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
                filteredSegments.map((seg) => (
                  <div
                    key={seg.id}
                    onClick={() => seekVideo(seg.start_time)}
                    className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-800/40 cursor-pointer transition group"
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                      <span className="font-mono text-indigo-400 group-hover:underline">
                        {formatTime(seg.start_time)} - {formatTime(seg.end_time)}
                      </span>
                      {seg.speaker && <span className="text-slate-400">{seg.speaker}</span>}
                    </div>
                    <p className="text-xs text-slate-300 leading-snug group-hover:text-white">
                      {seg.text}
                    </p>
                  </div>
                ))
              )
            ) : (
              /* Discovered Clips */
              clips.length === 0 ? (
                <div className="py-20 text-center text-slate-500 text-xs">
                  No highlight clips extracted yet.
                </div>
              ) : (
                clips.map((clip) => (
                  <div
                    key={clip.id}
                    className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-bold text-slate-200 hover:text-indigo-400 truncate">
                        {clip.emoji} {clip.title || clip.rank_title}
                      </h4>
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold text-[10px] shrink-0 border border-amber-500/20">
                        <Flame className="w-2.5 h-2.5 fill-current" />
                        <span>{clip.ai_score || clip.virality_score}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <button
                        onClick={() => seekVideo(clip.start_time)}
                        className="font-mono text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>
                          {formatTime(clip.start_time)} - {formatTime(clip.end_time)} ({clip.duration}s)
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
                ))
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
