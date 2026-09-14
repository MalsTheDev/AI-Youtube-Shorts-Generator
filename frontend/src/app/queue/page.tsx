"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Play,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Video,
  Layers,
  Sparkles,
  ExternalLink,
  Trash2,
  RefreshCw,
  X,
  Download,
  Film,
  ListVideo,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  Plus,
  Check
} from "lucide-react";

interface ShortClip {
  title?: string;
  hook_sentence?: string;
  score?: number | string;
  start_time?: number;
  end_time?: number;
  clip_url?: string;
  stream_url?: string;
  error?: string;
}

interface JobResult {
  mode?: string;
  source_video_url?: string;
  header_title?: string;
  highlights?: Array<any>;
  candidates?: Array<any>;
  shorts?: ShortClip[];
}

interface Job {
  id: string;
  batch_id: string;
  url: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress?: string;
  num_clips: number;
  aspect_ratio: string;
  download_format: string;
  mode: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  final_video_url?: string | null;
  header_title?: string | null;
  layout_mode?: string | null;
  captions_enabled?: boolean | null;
  user_prompt?: string | null;
  candidates?: Array<any>;
  result?: JobResult;
  error?: string;
}

interface PrecutSlot {
  id: string;
  url: string;
  title: string;
}

const DEFAULT_PRECUT_SLOTS: PrecutSlot[] = [
  { id: "1", url: "", title: "" },
  { id: "2", url: "", title: "" },
  { id: "3", url: "", title: "" },
  { id: "4", url: "", title: "" },
  { id: "5", url: "", title: "" },
];

const SAMPLE_PRECUT_SLOTS: PrecutSlot[] = [
  { id: "1", url: "https://www.youtube.com/watch?v=HubJndtnjR4", title: "Top Epic Moment" },
  { id: "2", url: "https://www.youtube.com/watch?v=sample_video_2", title: "Hilarious Reaction" },
  { id: "3", url: "https://www.youtube.com/watch?v=ssVHdM3263Q", title: "Unbelievable Timing" },
  { id: "4", url: "https://www.youtube.com/watch?v=eiHklQvqLYw", title: "Crazy Comeback" },
  { id: "5", url: "https://www.youtube.com/watch?v=gTKS8SAwUzE", title: "The Grand Finale" },
];

export default function QueuePage() {
  const router = useRouter();

  // Mode switcher: "youtube_batch" | "assemble_precut"
  const [modeTab, setModeTab] = useState<"youtube_batch" | "assemble_precut">("youtube_batch");

  // Pre-cut Clips Assemble State
  const [assembleClips, setAssembleClips] = useState<PrecutSlot[]>(DEFAULT_PRECUT_SLOTS);
  const [assembleHeaderTitle, setAssembleHeaderTitle] = useState("RANKING TOP 5 MOMENTS");
  const [assembleLayoutMode, setAssembleLayoutMode] = useState("1:1");
  const [assembleChannelHandle, setAssembleChannelHandle] = useState("@ViralShorts");
  const [assembleCaptionsEnabled, setAssembleCaptionsEnabled] = useState(true);
  const [isAssembling, setIsAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const [urlsInput, setUrlsInput] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [numClips, setNumClips] = useState(10);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [layoutMode, setLayoutMode] = useState("1:1");
  const [channelHandle, setChannelHandle] = useState("");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [downloadFormat, setDownloadFormat] = useState("720");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Quick Preview Drawer/Modal State
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedClipIndex, setSelectedClipIndex] = useState(0);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) || null;

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data: Job[] = await res.json();
      setJobs(data);
    } catch (err: any) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  // Polling every 3 seconds
  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Escape key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedJobId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Submit batch job
  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const urls = urlsInput
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length === 0) {
      setErrorMsg("Please enter at least one YouTube URL.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/jobs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          user_prompt: userPrompt.trim() || undefined,
          num_clips: numClips,
          aspect_ratio: aspectRatio,
          layout_mode: layoutMode,
          channel_handle: channelHandle.trim() || undefined,
          captions_enabled: captionsEnabled,
          download_format: downloadFormat,
          mode: "local",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to submit batch job.");
      }

      const data = await res.json();
      setSuccessMsg(`Enqueued ${data.total_jobs} video(s) into processing queue!`);
      setUrlsInput("");
      setUserPrompt("");
      await fetchJobs();
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred while submitting.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Pre-cut slot handlers
  const handleSlotChange = (index: number, field: "url" | "title", value: string) => {
    setAssembleClips((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleMoveSlot = (index: number, direction: "up" | "down") => {
    setAssembleClips((prev) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  const handleRemoveSlot = (index: number) => {
    if (assembleClips.length <= 2) return;
    setAssembleClips((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddSlot = () => {
    if (assembleClips.length >= 10) return;
    setAssembleClips((prev) => [
      ...prev,
      { id: String(Date.now()), url: "", title: "" },
    ]);
  };

  const handleInsertPrecutSamples = () => {
    setAssembleClips(SAMPLE_PRECUT_SLOTS.map((s, i) => ({ ...s, id: String(i + 1) })));
  };

  const handleClearSlots = () => {
    setAssembleClips([
      { id: "1", url: "", title: "" },
      { id: "2", url: "", title: "" },
      { id: "3", url: "", title: "" },
      { id: "4", url: "", title: "" },
      { id: "5", url: "", title: "" },
    ]);
  };

  const handleAssembleClips = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssembleError(null);
    const validClips = assembleClips.filter((c) => c.url.trim().length > 0);
    if (validClips.length < 2) {
      setAssembleError("Please provide at least 2 clip URLs to assemble a ranking short.");
      return;
    }

    setIsAssembling(true);
    try {
      const res = await fetch("/api/shorts/assemble-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: validClips.map((c) => ({
            url: c.url.trim(),
            title: c.title.trim() || undefined,
          })),
          header_title: assembleHeaderTitle.trim() || "RANKING TOP 5 MOMENTS",
          layout_mode: assembleLayoutMode,
          channel_handle: assembleChannelHandle.trim() || undefined,
          captions_enabled: assembleCaptionsEnabled,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to assemble ranking video.");
      }

      const data = await res.json();
      setSuccessMsg(`Ranking short created with ${data.clips_count} clips! Redirecting to studio...`);
      await fetchJobs();
      router.push(data.redirect_url);
    } catch (err: any) {
      setAssembleError(err.message || "Assembly failed.");
    } finally {
      setIsAssembling(false);
    }
  };

  // Delete job
  const handleDeleteJob = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (selectedJobId === jobId) setSelectedJobId(null);
    } catch (err) {
      console.error("Failed to delete job:", err);
    }
  };

  // Clear all jobs
  const handleClearAll = async () => {
    if (!confirm("Are you sure you want to clear the entire job queue?")) return;
    try {
      await fetch("/api/jobs/clear", { method: "POST" });
      setJobs([]);
      setSelectedJobId(null);
    } catch (err) {
      console.error("Failed to clear jobs:", err);
    }
  };

  // Quick fill sample URLs
  const handleInsertSamples = () => {
    const samples = [
      "https://www.youtube.com/watch?v=HubJndtnjR4",
      "https://www.youtube.com/watch?v=sample_video_2",
    ];
    setUrlsInput(samples.join("\n"));
  };

  const renderStatusBadge = (status: Job["status"], progress?: string) => {
    switch (status) {
      case "queued":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5" />
            Queued
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Processing
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        );
    }
  };

  const completedClips = selectedJob?.result?.shorts || [];
  const currentClip = completedClips[selectedClipIndex] || completedClips[0];

  return (
    <div className="min-h-screen text-slate-100 flex flex-col bg-slate-950">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/25">
              <Film className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">
                AI Shorts Generator
              </h1>
              <p className="text-xs text-slate-400">
                Ranking Viral Short Factory & Batch Processing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/60">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Auto-refresh (3s)
            </div>
            <button
              onClick={() => fetchJobs()}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="Refresh queue now"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Total Jobs
              </span>
              <ListVideo className="w-4 h-4 text-indigo-400" />
            </div>
            <p className="text-2xl font-bold mt-2 text-white">{jobs.length}</p>
          </div>

          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                In Queue
              </span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-2xl font-bold mt-2 text-amber-400">
              {jobs.filter((j) => j.status === "queued").length}
            </p>
          </div>

          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Processing
              </span>
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
            <p className="text-2xl font-bold mt-2 text-blue-400">
              {jobs.filter((j) => j.status === "processing").length}
            </p>
          </div>

          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Completed
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold mt-2 text-emerald-400">
              {jobs.filter((j) => j.status === "completed").length}
            </p>
          </div>
        </div>

        {/* Mode Switcher & Submission Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          {/* Top Mode Tabs */}
          <div className="flex items-center gap-2 p-1.5 bg-slate-950/80 border border-slate-800/80 rounded-xl mb-6">
            <button
              type="button"
              id="tab-youtube-batch"
              onClick={() => setModeTab("youtube_batch")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all ${
                modeTab === "youtube_batch"
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/25"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Layers className="w-4 h-4 text-indigo-400" />
              Auto-Extract Highlights (Full Video)
            </button>
            <button
              type="button"
              id="tab-assemble-precut"
              onClick={() => setModeTab("assemble_precut")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all ${
                modeTab === "assemble_precut"
                  ? "bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 font-black shadow-md shadow-amber-500/25"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <Film className="w-4 h-4 text-amber-400" />
              Assemble Pre-Cut Clips (e.g. 5x 1-Min YouTube Clips)
            </button>
          </div>

          {modeTab === "youtube_batch" ? (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-400" />
                    Submit Batch Video URLs
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Paste YouTube URLs to extract 10 ranked viral candidates with word-level subtitles.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleInsertSamples}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-lg transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Insert Sample URLs
                </button>
              </div>

              <form onSubmit={handleSubmitBatch} className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="urls-input"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    YouTube Video URLs (One per line)
                  </label>
                  <textarea
                    id="urls-input"
                    rows={4}
                    value={urlsInput}
                    onChange={(e) => setUrlsInput(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=...&#10;https://youtu.be/...&#10;https://www.youtube.com/watch?v=..."
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 font-mono resize-y"
                  />
                </div>

                {/* AI Prompt & Guidance Field */}
                <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="user-prompt-input"
                      className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      AI Prompt Guidance (Optional)
                    </label>
                    <span className="text-[10px] text-slate-400">
                      Direct AI on character, topic, or specific moments
                    </span>
                  </div>
                  <input
                    id="user-prompt-input"
                    type="text"
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                    placeholder='e.g. "Return all the stewie best moments" or "Find the most intense arguments"'
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                  />
                  <p className="text-[11px] text-slate-400">
                    Leave empty for general viral moments, or guide the AI to strictly extract moments of a specific character, joke, or theme.
                  </p>
                </div>

                {/* Options Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Video Frame Layout
                    </label>
                    <select
                      value={layoutMode}
                      onChange={(e) => setLayoutMode(e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="1:1">1:1 Square (Blurred BG) ✨</option>
                      <option value="16:9">16:9 Full Ratio (Blurred BG)</option>
                      <option value="9:16">9:16 Full Screen Vertical</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Karaoke Subtitles
                    </label>
                    <select
                      value={captionsEnabled ? "on" : "off"}
                      onChange={(e) => setCaptionsEnabled(e.target.value === "on")}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="on">Captions ON (Compact 1–2 Lines)</option>
                      <option value="off">Captions OFF (Clean Video)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Watermark Channel Handle
                    </label>
                    <input
                      type="text"
                      value={channelHandle}
                      onChange={(e) => setChannelHandle(e.target.value)}
                      placeholder="@MalsTheDev"
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Candidate Highlights Extracted
                    </label>
                    <select
                      value={numClips}
                      onChange={(e) => setNumClips(Number(e.target.value))}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value={10}>10 Candidates (Recommended)</option>
                      <option value={5}>5 Highlights</option>
                      <option value={3}>3 Highlights</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Download Resolution
                    </label>
                    <select
                      value={downloadFormat}
                      onChange={(e) => setDownloadFormat(e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="720">720p HD (Fast & High Quality)</option>
                      <option value="1080">1080p FHD</option>
                      <option value="480">480p</option>
                    </select>
                  </div>
                </div>

                {errorMsg && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setUrlsInput("")}
                    disabled={!urlsInput || isSubmitting}
                    className="px-4 py-2 text-xs text-slate-400 hover:text-white transition disabled:opacity-40"
                  >
                    Clear
                  </button>
                  <button
                    type="submit"
                    id="submit-batch-btn"
                    disabled={isSubmitting || !urlsInput.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Enqueuing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-white" />
                        Enqueue Batch Job
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* New Assemble Pre-Cut Clips Form */
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Film className="w-4 h-4 text-amber-400" />
                    Assemble Pre-Cut Clips into Ranking Short
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Provide YouTube links for individual clips (e.g. 5x 1-minute clips). The engine downloads each clip, runs Whisper karaoke subtitles, and composites them into a single ranking video.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    id="insert-precut-samples-btn"
                    onClick={handleInsertPrecutSamples}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Fill 5 Sample Clips
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSlots}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition"
                  >
                    Reset Slots
                  </button>
                </div>
              </div>

              <form onSubmit={handleAssembleClips} className="space-y-5">
                {/* Ranking ladder cards */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                      Ranking Ladder Slots ({assembleClips.length} Clips)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Rank #1 plays first, followed sequentially by Rank #2, #3, etc.
                    </span>
                  </div>

                  {assembleClips.map((clip, idx) => (
                    <div
                      key={clip.id}
                      className="p-3.5 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-2.5 transition hover:border-slate-700"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded text-xs font-black bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/30">
                            RANK #{idx + 1}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Clip segment #{idx + 1} of {assembleClips.length}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveSlot(idx, "up")}
                            disabled={idx === 0}
                            className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 rounded hover:bg-slate-800 transition"
                            title="Move up in rank order"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveSlot(idx, "down")}
                            disabled={idx === assembleClips.length - 1}
                            className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 rounded hover:bg-slate-800 transition"
                            title="Move down in rank order"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          {assembleClips.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSlot(idx)}
                              className="p-1.5 text-rose-400 hover:text-rose-200 rounded hover:bg-rose-950/40 ml-1 transition"
                              title="Delete clip slot"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                        <div className="sm:col-span-7">
                          <label className="block text-[11px] font-medium text-slate-400 mb-1">
                            YouTube Clip URL *
                          </label>
                          <input
                            type="text"
                            value={clip.url}
                            onChange={(e) => handleSlotChange(idx, "url", e.target.value)}
                            placeholder="https://www.youtube.com/watch?v=... or local path"
                            className="w-full bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                          />
                        </div>
                        <div className="sm:col-span-5">
                          <label className="block text-[11px] font-medium text-slate-400 mb-1">
                            Custom Rank Title (Optional)
                          </label>
                          <input
                            type="text"
                            value={clip.title}
                            onChange={(e) => handleSlotChange(idx, "title", e.target.value)}
                            placeholder="e.g. Stewie Time Machine (Auto from clip if empty)"
                            className="w-full bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {assembleClips.length < 10 && (
                    <button
                      type="button"
                      id="add-precut-slot-btn"
                      onClick={handleAddSlot}
                      className="w-full py-2.5 border border-dashed border-slate-700/80 hover:border-amber-500/50 rounded-xl text-xs font-semibold text-slate-400 hover:text-amber-300 flex items-center justify-center gap-1.5 transition bg-slate-950/40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Another Clip Slot (Slot #{assembleClips.length + 1})
                    </button>
                  )}
                </div>

                {/* Short Customization Settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-800/80">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Top Hook Header Title
                    </label>
                    <input
                      type="text"
                      id="assemble-header-title"
                      value={assembleHeaderTitle}
                      onChange={(e) => setAssembleHeaderTitle(e.target.value)}
                      placeholder="RANKING TOP 5 MOMENTS"
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-bold focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Video Frame Layout
                    </label>
                    <select
                      value={assembleLayoutMode}
                      onChange={(e) => setAssembleLayoutMode(e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="1:1">1:1 Square (Blurred BG) ✨</option>
                      <option value="16:9">16:9 Full Ratio (Blurred BG)</option>
                      <option value="9:16">9:16 Full Screen Vertical</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Karaoke Subtitles
                    </label>
                    <select
                      value={assembleCaptionsEnabled ? "on" : "off"}
                      onChange={(e) => setAssembleCaptionsEnabled(e.target.value === "on")}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="on">Captions ON (Compact 1–2 Lines)</option>
                      <option value="off">Captions OFF (Clean Video)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Watermark Channel Handle
                    </label>
                    <input
                      type="text"
                      value={assembleChannelHandle}
                      onChange={(e) => setAssembleChannelHandle(e.target.value)}
                      placeholder="@ViralShorts"
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>

                {assembleError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{assembleError}</span>
                  </div>
                )}

                {isAssembling && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 space-y-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                      <span>Downloading clips, generating Whisper karaoke subtitles, and compositing short...</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      This takes ~30-60 seconds. You will be redirected to the Review Studio automatically once complete!
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    id="submit-assemble-btn"
                    disabled={isAssembling || assembleClips.filter((c) => c.url.trim()).length < 2}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAssembling ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                        Assembling & Rendering Short...
                      </>
                    ) : (
                      <>
                        <Film className="w-4 h-4 text-slate-950" />
                        🚀 Assemble Ranking Short ({assembleClips.filter((c) => c.url.trim()).length} Clips)
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Status Table Card */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden backdrop-blur-sm">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-white">
                Queue & Job Status
              </h3>
              <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full">
                {jobs.length} total
              </span>
            </div>
            {jobs.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Queue
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400">
                  <th className="py-3 px-6 font-medium">Job ID</th>
                  <th className="py-3 px-6 font-medium">Video URL</th>
                  <th className="py-3 px-6 font-medium">Status & Progress</th>
                  <th className="py-3 px-6 font-medium">Candidates</th>
                  <th className="py-3 px-6 font-medium">Submitted</th>
                  <th className="py-3 px-6 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {jobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-12 text-center text-slate-500"
                    >
                      {isLoadingJobs ? (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading jobs...
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p>No video processing jobs found.</p>
                          <p className="text-slate-600">
                            Paste YouTube URLs above to start processing!
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => {
                    const candidateCount = job.candidates?.length ?? (job.result?.candidates?.length || job.result?.shorts?.length || 0);
                    return (
                      <tr
                        key={job.id}
                        className="hover:bg-slate-800/40 transition group"
                      >
                        <td className="py-4 px-6 font-mono text-slate-400">
                          {job.id}
                        </td>
                        <td className="py-4 px-6 max-w-xs truncate">
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:underline inline-flex items-center gap-1 truncate"
                            title={job.url}
                          >
                            <span className="truncate">{job.url}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" />
                          </a>
                          {job.user_prompt && (
                            <div className="flex items-center gap-1 text-[11px] text-amber-300 mt-1 truncate" title={job.user_prompt}>
                              <Sparkles className="w-3 h-3 flex-shrink-0 text-amber-400" />
                              <span className="truncate font-medium italic">"{job.user_prompt}"</span>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex flex-col gap-1 items-start">
                            {renderStatusBadge(job.status, job.progress)}
                            {job.progress && job.status === "processing" && (
                              <span className="text-[11px] text-slate-400 animate-pulse">
                                {job.progress}
                              </span>
                            )}
                            {job.error && (
                              <span
                                className="text-[11px] text-rose-400 max-w-xs truncate"
                                title={job.error}
                              >
                                {job.error}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          {job.status === "completed" ? (
                            <span className="inline-flex items-center gap-1 text-slate-200">
                              <Film className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="font-semibold text-white">
                                {candidateCount}
                              </span>{" "}
                              candidates
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              Target: {job.num_clips}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-slate-400 whitespace-nowrap">
                          {new Date(job.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="py-4 px-6 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {job.status === "completed" && (
                              <>
                                <Link
                                  href={`/review/${job.id}`}
                                  id={`review-btn-${job.id}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-600/25 transition cursor-pointer"
                                >
                                  <SlidersHorizontal className="w-3.5 h-3.5" />
                                  Review & Customize
                                </Link>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedJobId(job.id);
                                    setSelectedClipIndex(0);
                                  }}
                                  className="preview-clips-btn inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700/60 transition cursor-pointer"
                                  title="Quick preview clips"
                                >
                                  <Play className="w-3 h-3 fill-slate-300" />
                                  Preview
                                </button>
                              </>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                              title="Delete job"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Quick 9:16 Video Preview Modal */}
      {selectedJob && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200"
          onClick={() => setSelectedJobId(null)}
        >
          <div
            className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Clip Preview: {selectedJob.id}
                  </h3>
                  <p className="text-xs text-slate-400 truncate max-w-md">
                    {selectedJob.url}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedJobId(null);
                }}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                title="Close modal (Esc)"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 flex flex-col lg:flex-row gap-8 items-center lg:items-start justify-center">
              {/* Vertical 9:16 Player Container */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-[280px] sm:w-[320px] aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-700/80 relative flex items-center justify-center">
                  {currentClip?.stream_url ? (
                    <video
                      key={currentClip.stream_url}
                      src={currentClip.stream_url}
                      controls
                      autoPlay
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-6 text-slate-500">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2 text-amber-400" />
                      <p className="text-xs">No playable stream URL available for this clip.</p>
                      {currentClip?.error && (
                        <p className="text-[11px] text-rose-400 mt-2">{currentClip.error}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-center">
                  <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
                    Aspect Ratio: 9:16 Vertical
                  </span>
                </div>
              </div>

              {/* Clip Details & Selector */}
              <div className="flex-1 w-full space-y-6">
                {completedClips.length > 1 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                      Available Highlights ({completedClips.length})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {completedClips.map((clip, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedClipIndex(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                            selectedClipIndex === idx
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          <Film className="w-3.5 h-3.5" />
                          Clip #{idx + 1}
                          {clip.score && (
                            <span className="text-[10px] opacity-80">
                              ({clip.score})
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {currentClip && (
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div>
                      <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">
                        Highlight Title
                      </span>
                      <h4 className="text-base font-bold text-white mt-0.5">
                        {currentClip.title || `Short #${selectedClipIndex + 1}`}
                      </h4>
                    </div>

                    {currentClip.hook_sentence && (
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          Hook Sentence
                        </span>
                        <p className="text-xs text-slate-200 mt-0.5 italic bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                          &ldquo;{currentClip.hook_sentence}&rdquo;
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase">
                          Virality Score
                        </span>
                        <p className="text-sm font-semibold text-emerald-400">
                          {currentClip.score ?? "N/A"}/100
                        </p>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-400 uppercase">
                          Interval
                        </span>
                        <p className="text-sm font-mono text-slate-200">
                          {currentClip.start_time !== undefined && currentClip.end_time !== undefined
                            ? `${currentClip.start_time.toFixed(1)}s → ${currentClip.end_time.toFixed(1)}s`
                            : "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Link
                    href={`/review/${selectedJob.id}`}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/25 transition"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    Open in Review Studio
                  </Link>
                  {currentClip?.stream_url && (
                    <a
                      href={currentClip.stream_url}
                      download={`short_${selectedJob.id}_${selectedClipIndex + 1}.mp4`}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/20 transition"
                    >
                      <Download className="w-4 h-4" />
                      Download .mp4
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedJobId(null)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-semibold transition ml-auto cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
