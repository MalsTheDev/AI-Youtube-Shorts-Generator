"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Download,
  ExternalLink,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Film,
  Check,
  Scissors,
  Flame,
  Video,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Eye,
  SlidersHorizontal,
  Zap,
  Repeat,
  Subtitles,
} from "lucide-react";

export function toStreamUrl(raw?: string | null): string | null {
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

interface CandidateClip {
  id?: string | number;
  rank_title?: string;
  title?: string;
  start_time: number;
  end_time: number;
  score?: number | string;
  virality_score?: number | string;
  hook_sentence?: string;
  virality_reason?: string;
  clip_url?: string;
  stream_url?: string;
  source_stream_url?: string | null;
  source_video_path?: string | null;
  source_video_url?: string | null;
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
  source_stream_url?: string | null;
  header_title?: string | null;
  layout_mode?: string | null;
  channel_handle?: string | null;
  captions_enabled?: boolean | null;
  user_prompt?: string | null;
  candidates?: CandidateClip[];
  result?: {
    mode?: string;
    source_video_url?: string;
    source_stream_url?: string;
    header_title?: string;
    user_prompt?: string;
    highlights?: CandidateClip[];
    candidates?: CandidateClip[];
    shorts?: CandidateClip[];
  };
  error?: string;
}

export default function ReviewJobPage() {
  const params = useParams();
  const jobId = params?.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Customization State
  const [headerTitle, setHeaderTitle] = useState<string>("RANKING BEST RANDOM\nMOMENTS FAMILY GUY");
  const [layoutMode, setLayoutMode] = useState<string>("1:1");
  const [channelHandle, setChannelHandle] = useState<string>("@MalsTheDev");
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(true);
  const [templateType, setTemplateType] = useState<"ranking" | "single_title">("ranking");
  const [aiPromptGuidance, setAiPromptGuidance] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editableClips, setEditableClips] = useState<CandidateClip[]>([]);

  // Video Player & Instant Cut Preview State
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeCutRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [playerMode, setPlayerMode] = useState<"final" | "cut">("final");
  const [activeCutClipId, setActiveCutClipId] = useState<string | null>(null);
  const [activeCutRange, setActiveCutRange] = useState<{ start: number; end: number } | null>(null);
  const [isLoopingCut, setIsLoopingCut] = useState(true);
  const [playerCurrentTime, setPlayerCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState<number | null>(null);

  // Re-Analysis & Rendering State
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [reanalyzeSuccess, setReanalyzeSuccess] = useState<string | null>(null);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderSuccess, setRenderSuccess] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Fetch job details
  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data: Job = await res.json();
      setJob(data);

      // Extract candidates
      const rawCandidates: CandidateClip[] =
        data.candidates ||
        data.result?.candidates ||
        data.result?.highlights ||
        data.result?.shorts ||
        [];

      // Normalize candidate objects with IDs and titles
      const normalized: CandidateClip[] = rawCandidates.map((c, idx) => ({
        ...c,
        id: c.id ? String(c.id) : String(idx + 1),
        rank_title: c.rank_title || c.title || `Moment #${idx + 1}`,
        score: c.score ?? c.virality_score ?? 90,
      }));

      setEditableClips(normalized);

      // Initialize header title if not already modified
      if (data.header_title) {
        setHeaderTitle(data.header_title);
      }
      if (data.layout_mode) {
        setLayoutMode(data.layout_mode);
      }
      if (data.channel_handle) {
        setChannelHandle(data.channel_handle);
      }
      if (data.captions_enabled !== undefined && data.captions_enabled !== null) {
        setCaptionsEnabled(data.captions_enabled);
      }
      if ((data as any).template_type) {
        setTemplateType((data as any).template_type as "ranking" | "single_title");
      }
      if (data.user_prompt) {
        setAiPromptGuidance(data.user_prompt);
      }

      // Default selection to top 3 candidates if none selected
      setSelectedIds((prev) => {
        if (prev.length > 0) return prev;
        return normalized.slice(0, Math.min(3, normalized.length)).map((c) => String(c.id));
      });

      // Video preview initial priority: final short > first short > null
      if (data.final_video_url) {
        setActivePreviewUrl(toStreamUrl(data.final_video_url));
        setPlayerMode("final");
      } else if (normalized[0]) {
        const validSrc =
          toStreamUrl(data.source_stream_url) ||
          toStreamUrl(data.result?.source_stream_url) ||
          toStreamUrl(normalized[0].source_stream_url) ||
          toStreamUrl(normalized[0].stream_url) ||
          toStreamUrl(data.result?.source_video_url);

        if (validSrc) {
          setActivePreviewUrl(validSrc);
          setPlayerMode("cut");
          setActiveCutClipId(String(normalized[0].id));
          const range = { start: normalized[0].start_time, end: normalized[0].end_time };
          activeCutRangeRef.current = range;
          setActiveCutRange(range);
          setActiveCandidateIndex(0);
        }
      }
    } catch (err: any) {
      console.error("Failed to fetch job:", err);
      setErrorMsg(err.message || "Failed to load job details.");
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Auto-poll when job is queued or processing
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing")) return;
    const interval = setInterval(() => {
      fetchJob();
    }, 2500);
    return () => clearInterval(interval);
  }, [job?.status, fetchJob]);

  // Toggle clip selection
  const toggleClipSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Quick select actions
  const handleSelectTop3 = () => {
    setSelectedIds(editableClips.slice(0, Math.min(3, editableClips.length)).map((c) => String(c.id)));
  };

  const handleSelectAll = () => {
    setSelectedIds(editableClips.map((c) => String(c.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  // Move clip up / down in the selected list
  const handleMoveClip = (index: number, direction: "up" | "down") => {
    const newSelected = [...selectedIds];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSelected.length) return;
    const temp = newSelected[index];
    newSelected[index] = newSelected[targetIndex];
    newSelected[targetIndex] = temp;
    setSelectedIds(newSelected);
  };

  // Update field of an editable clip
  const updateClipField = (id: string, field: keyof CandidateClip, value: any) => {
    setEditableClips((prev) =>
      prev.map((c) => (String(c.id) === id ? { ...c, [field]: value } : c))
    );
  };

  // Resolve source video URL
  const getSourceVideoUrl = useCallback(() => {
    const rawSrc = job?.source_stream_url || job?.result?.source_stream_url || job?.result?.source_video_url;
    return toStreamUrl(rawSrc);
  }, [job]);

  // Resolve previewable video URL for any candidate clip
  const getClipPreviewUrl = useCallback((clip?: CandidateClip | null) => {
    if (!clip) return getSourceVideoUrl();
    return (
      toStreamUrl(clip.source_stream_url) ||
      toStreamUrl(clip.stream_url) ||
      getSourceVideoUrl() ||
      toStreamUrl(clip.source_video_path) ||
      toStreamUrl(clip.clip_url) ||
      null
    );
  }, [getSourceVideoUrl]);

  // Instant In-Browser Cut Preview
  const handleInstantPreviewCut = (clip: CandidateClip, idx?: number) => {
    const sourceUrl = getClipPreviewUrl(clip);
    if (!sourceUrl) return;

    const range = { start: clip.start_time, end: clip.end_time };
    activeCutRangeRef.current = range;
    setPlayerMode("cut");
    setActiveCutClipId(String(clip.id));
    setActiveCutRange(range);
    if (idx !== undefined) setActiveCandidateIndex(idx);

    if (activePreviewUrl !== sourceUrl) {
      setActivePreviewUrl(sourceUrl);
    } else if (videoRef.current) {
      videoRef.current.currentTime = clip.start_time;
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // Video time update event: loops/stops at end_time
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    setPlayerCurrentTime(current);

    if (playerMode === "cut" && activeCutRange) {
      if (current < activeCutRange.start - 0.5) {
        videoRef.current.currentTime = activeCutRange.start;
      } else if (current >= activeCutRange.end) {
        if (isLoopingCut) {
          videoRef.current.currentTime = activeCutRange.start;
          videoRef.current.play().catch(() => {});
        } else {
          videoRef.current.pause();
          videoRef.current.currentTime = activeCutRange.end;
          setIsPlaying(false);
        }
      }
    }
  };

  // Loaded metadata handler for video seeking
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    const range = activeCutRangeRef.current || activeCutRange;
    if (playerMode === "cut" && range) {
      videoRef.current.currentTime = range.start;
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // Update cut timing and immediately seek video to give zero-latency preview
  const handleUpdateCutTime = (clipId: string, field: "start_time" | "end_time", value: number) => {
    const safeVal = Math.max(0, parseFloat(value.toFixed(2)) || 0);
    updateClipField(clipId, field, safeVal);

    if (activeCutClipId === clipId) {
      setActiveCutRange((prev) => {
        const newRange = {
          start: field === "start_time" ? safeVal : (prev?.start ?? 0),
          end: field === "end_time" ? safeVal : (prev?.end ?? safeVal + 5),
        };
        activeCutRangeRef.current = newRange;
        return newRange;
      });

      if (videoRef.current) {
        if (field === "start_time") {
          videoRef.current.currentTime = safeVal;
        } else if (field === "end_time") {
          // Seek to 2 seconds before the end cut so user sees the ending transition
          videoRef.current.currentTime = Math.max(safeVal - 2.5, 0);
        }
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  // Micro-adjustment nudges (+/- 0.2s or 1.0s)
  const handleNudgeCutTime = (clipId: string, field: "start_time" | "end_time", delta: number) => {
    const clip = editableClips.find((c) => String(c.id) === clipId);
    if (!clip) return;
    const currentVal = clip[field];
    const newVal = Math.max(0, currentVal + delta);
    handleUpdateCutTime(clipId, field, newVal);
  };

  // Set cut boundary from player's current frame
  const handleSetFromPlayer = (clipId: string, field: "start_time" | "end_time") => {
    if (!videoRef.current) return;
    const currentFrameTime = videoRef.current.currentTime;
    handleUpdateCutTime(clipId, field, currentFrameTime);
  };

  // Quick jump buttons
  const handleJumpToStart = () => {
    if (!videoRef.current || !activeCutRange) return;
    videoRef.current.currentTime = activeCutRange.start;
    videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  const handleJumpToEndHook = () => {
    if (!videoRef.current || !activeCutRange) return;
    videoRef.current.currentTime = Math.max(activeCutRange.end - 2.5, activeCutRange.start);
    videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (playerMode === "cut" && activeCutRange && (videoRef.current.currentTime < activeCutRange.start || videoRef.current.currentTime >= activeCutRange.end)) {
        videoRef.current.currentTime = activeCutRange.start;
      }
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // Preview final short
  const handlePreviewFinalShort = () => {
    if (job?.final_video_url) {
      const finalUrl = `${job.final_video_url}?t=${Date.now()}`;
      setActivePreviewUrl(finalUrl);
      setPlayerMode("final");
      setActiveCutClipId(null);
      setActiveCutRange(null);
      setActiveCandidateIndex(null);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  // Re-analyze highlights with custom AI prompt guidance
  const handleReanalyze = async () => {
    if (!aiPromptGuidance.trim()) {
      setReanalyzeError("Please enter an AI prompt instruction, e.g. 'Return all the stewie best moments'.");
      return;
    }

    setIsReanalyzing(true);
    setReanalyzeError(null);
    setReanalyzeSuccess(null);

    try {
      const res = await fetch(`/api/jobs/${jobId}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_prompt: aiPromptGuidance.trim(),
          num_clips: 10,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "AI Re-analysis failed.");
      }

      const data = await res.json();
      setReanalyzeSuccess(`Extracted ${data.candidates?.length || 0} moments for: "${aiPromptGuidance.trim()}"!`);

      if (data.header_title) {
        setHeaderTitle(data.header_title);
      }

      const rawCandidates: CandidateClip[] = data.candidates || [];
      const normalized: CandidateClip[] = rawCandidates.map((c, idx) => ({
        ...c,
        id: c.id ? String(c.id) : String(idx + 1),
        rank_title: c.rank_title || c.title || `Moment #${idx + 1}`,
        score: c.score ?? c.virality_score ?? 90,
      }));

      setEditableClips(normalized);
      setSelectedIds(normalized.slice(0, Math.min(3, normalized.length)).map((c) => String(c.id)));

      if (normalized.length > 0) {
        setActiveCutClipId(String(normalized[0].id));
        setActiveCutRange({ start: normalized[0].start_time, end: normalized[0].end_time });
        setActiveCandidateIndex(0);
      }

      if (data.job) {
        setJob(data.job);
      }
    } catch (err: any) {
      console.error("Failed to re-analyze highlights:", err);
      setReanalyzeError(err.message || "Failed to re-analyze highlights with AI.");
    } finally {
      setIsReanalyzing(false);
    }
  };

  // Execute Render & Export
  const handleRenderShort = async () => {
    if (selectedIds.length === 0) {
      setRenderError("Please select at least one clip to render.");
      return;
    }

    setIsRendering(true);
    setRenderError(null);
    setRenderSuccess(null);

    // Build the ordered array of selected clips with any customized titles/timings
    const selectedClipsData = selectedIds
      .map((id) => editableClips.find((c) => String(c.id) === id))
      .filter(Boolean) as CandidateClip[];

    try {
      const res = await fetch(`/api/jobs/${jobId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          header_title: headerTitle.trim(),
          clips: selectedClipsData,
          all_clips: editableClips,
          layout_mode: layoutMode,
          channel_handle: channelHandle.trim() || undefined,
          captions_enabled: captionsEnabled,
          template_type: templateType,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Rendering failed.");
      }

      const startData = await res.json();

      if (startData.final_video_url && (startData.render_status === "completed" || startData.render_status === "ready")) {
        setIsRendering(false);
        setRenderSuccess("Ranking Short compiled successfully with karaoke subtitles & dynamic overlay!");
        setActivePreviewUrl(`${startData.final_video_url}?t=${Date.now()}`);
        setPlayerMode("final");
        setActiveCandidateIndex(null);
        return;
      }

      // Poll until render completion
      let attempts = 0;
      const maxAttempts = 480; // 12 minutes max (re-encoding concat takes longer)
      const pollInterval = 1500; // 1.5 seconds

      const pollTimer = setInterval(async () => {
        attempts++;
        try {
          const pollRes = await fetch(`/api/jobs/${jobId}`);
          if (!pollRes.ok) return;
          const pollJob = await pollRes.json();
          setJob(pollJob);

          if (pollJob.render_status === "completed" || pollJob.render_status === "ready") {
            clearInterval(pollTimer);
            setIsRendering(false);
            setRenderSuccess("Ranking Short compiled successfully with karaoke subtitles & dynamic overlay!");
            const streamUrl = pollJob.final_video_url
              ? `${pollJob.final_video_url}?t=${Date.now()}`
              : null;
            setActivePreviewUrl(streamUrl);
            setPlayerMode("final");
            setActiveCandidateIndex(null);
          } else if (pollJob.render_status === "failed") {
            clearInterval(pollTimer);
            setIsRendering(false);
            setRenderError(pollJob.render_error || "Rendering failed.");
          } else if (attempts >= maxAttempts) {
            clearInterval(pollTimer);
            setIsRendering(false);
            setRenderError("Rendering timed out. Please check backend server.");
          }
        } catch (pollErr) {
          console.error("Polling error:", pollErr);
        }
      }, pollInterval);

    } catch (err: any) {
      console.error("Render failed:", err);
      setRenderError(err.message || "Failed to start render.");
      setIsRendering(false);
    }
  };

  // Ordered list of selected clips
  const orderedSelectedClips = selectedIds
    .map((id) => editableClips.find((c) => String(c.id) === id))
    .filter(Boolean) as CandidateClip[];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          <span>Loading video candidates and studio...</span>
        </div>
      </div>
    );
  }

  if (errorMsg || !job) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8 flex flex-col items-center justify-center">
        <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Job Not Found</h2>
        <p className="text-slate-400 text-sm mb-6">{errorMsg || "Unable to find the requested job."}</p>
        <Link
          href="/queue"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition"
        >
          Back to Batch Queue
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Studio Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/queue"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700/60 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Batch Queue
            </Link>

            <div className="h-4 w-px bg-slate-800" />

            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
              <h1 className="text-sm font-bold text-white">
                Ranking Short Studio
              </h1>
              <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">
                {job.id}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-slate-400 hover:text-indigo-400 inline-flex items-center gap-1 max-w-[200px] truncate"
              title={job.url}
            >
              <span className="truncate">{job.url}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>

            {job.status === "processing" ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processing
              </div>
            ) : job.status === "queued" ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Clock className="w-3.5 h-3.5" />
                Queued
              </div>
            ) : job.status === "failed" ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <AlertCircle className="w-3.5 h-3.5" />
                Failed
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Ready
              </div>
            )}
          </div>
        </div>

        {/* Live Processing Notice Banner */}
        {(job.status === "processing" || job.status === "queued") && (
          <div className="bg-amber-500/10 border-t border-b border-amber-500/20 px-4 py-2.5">
            <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-amber-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                <span>
                  <strong>Processing Active:</strong> {job.progress || "Extracting clips and transcribing..."}
                </span>
              </div>
              <span className="text-[11px] text-amber-400/80 font-mono">
                Auto-updating studio live every 2.5s
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Main Studio Body: 2-Column Responsive Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: 9:16 Vertical Video Player (Sticky) */}
        <div className="lg:col-span-5 flex flex-col items-center sticky top-24 space-y-4">
          <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl backdrop-blur-sm flex flex-col items-center">
            {/* Player Header with Mode Switcher */}
            <div className="w-full flex items-center justify-between mb-3 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    const targetClip =
                      editableClips.find((c) => String(c.id) === activeCutClipId) ||
                      (selectedIds.length > 0 ? editableClips.find((c) => String(c.id) === selectedIds[0]) : null) ||
                      editableClips[0];
                    if (targetClip) handleInstantPreviewCut(targetClip);
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition ${
                    playerMode === "cut"
                      ? "bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  Cut Preview (Instant)
                </button>
                <button
                  type="button"
                  onClick={handlePreviewFinalShort}
                  disabled={!job.final_video_url}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition ${
                    playerMode === "final"
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"
                      : "text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  Final Short
                </button>
              </div>

              {playerMode === "cut" ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Clock className="w-3 h-3" />
                  {activeCutRange
                    ? `${(Math.max(0, playerCurrentTime - activeCutRange.start)).toFixed(1)}s / ${(activeCutRange.end - activeCutRange.start).toFixed(1)}s`
                    : "Live Cut"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" />
                  Rendered
                </span>
              )}
            </div>

            {/* 9:16 HTML5 Video Canvas with Dynamic Live Template Overlays */}
            <div className="w-[300px] sm:w-[320px] aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border-2 border-slate-700/80 relative flex items-center justify-center select-none">
              {activePreviewUrl ? (
                <>
                  {/* For 1:1 and 16:9 in Cut Preview mode, show centered frame with stylized top/bottom blur */}
                  {playerMode === "cut" && layoutMode === "1:1" ? (
                    <div className="w-full h-full relative bg-slate-950 flex flex-col justify-between overflow-hidden">
                      {/* Top Overlay with Anton Italic styling */}
                      <div className="absolute top-4 left-0 right-0 px-2 text-center pointer-events-none z-20 transform -skew-x-12">
                        <p className="text-base sm:text-lg font-black tracking-wide uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [text-shadow:_2px_2px_0_#000,_-1px_-1px_0_#000,_1px_-1px_0_#000,_-1px_1px_0_#000]">
                          <span className="text-white">RANKING </span>
                          <span className="text-orange-500">BEST RANDOM</span>
                        </p>
                        <p className="text-base sm:text-lg font-black tracking-wide uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [text-shadow:_2px_2px_0_#000,_-1px_-1px_0_#000,_1px_-1px_0_#000,_-1px_1px_0_#000] -mt-1">
                          <span className="text-orange-500">MOMENTS </span>
                          <span className="text-emerald-400">
                            {headerTitle.includes("|")
                              ? headerTitle.split("|")[1]?.trim()
                              : headerTitle.includes("\n")
                              ? headerTitle.split("\n")[1]?.trim()
                              : "FAMILY GUY"}
                          </span>
                        </p>
                        {/* Current Rank Reveal Hook */}
                        <div className="mt-2 text-left pl-4 text-[11px] font-black space-y-0.5 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)] [text-shadow:_1.5px_1.5px_0_#000]">
                          <p className="text-yellow-400">
                            1. <span className="text-white truncate inline-block max-w-[200px] align-bottom">
                              {editableClips.find((c) => String(c.id) === activeCutClipId)?.rank_title || "Active Moment"}
                            </span>
                          </p>
                          <p className="text-white/70">2.</p>
                          <p className="text-orange-500/70">3.</p>
                        </div>
                      </div>

                      {/* 1:1 Video Container placed at y=720 (top 37.5%) */}
                      <div className="absolute top-[37.5%] w-full aspect-square bg-black border-y-2 border-amber-500/30 overflow-hidden shadow-2xl z-10 flex items-center justify-center">
                        <video
                          ref={videoRef}
                          id="review-player-video"
                          key={activePreviewUrl || "preview-1-1"}
                          src={activePreviewUrl}
                          playsInline
                          onTimeUpdate={handleTimeUpdate}
                          onLoadedMetadata={handleLoadedMetadata}
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      {/* Bottom Area: Watermark & Subtitle Placeholder */}
                      <div className="absolute bottom-4 left-0 right-0 px-3 text-center pointer-events-none z-20">
                        {channelHandle && (
                          <p className="text-xs font-bold text-slate-200/90 uppercase tracking-wider transform -skew-x-12 drop-shadow [text-shadow:_1px_1px_0_#000]">
                            {channelHandle}
                          </p>
                        )}
                        {captionsEnabled ? (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-amber-300 font-mono border border-amber-500/30">
                            Karaoke Subtitles (1-2 lines)
                          </span>
                        ) : (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-slate-500 font-mono border border-slate-700/40">
                            Subtitles OFF
                          </span>
                        )}
                      </div>
                    </div>
                  ) : playerMode === "cut" && layoutMode === "16:9" ? (
                    <div className="w-full h-full relative bg-slate-950 flex flex-col justify-between overflow-hidden">
                      {/* Top Overlay */}
                      <div className="absolute top-4 left-0 right-0 px-2 text-center pointer-events-none z-20 transform -skew-x-12">
                        <p className="text-base sm:text-lg font-black tracking-wide uppercase drop-shadow [text-shadow:_2px_2px_0_#000]">
                          <span className="text-white">RANKING </span>
                          <span className="text-orange-500">BEST RANDOM</span>
                        </p>
                        <p className="text-base sm:text-lg font-black tracking-wide uppercase drop-shadow [text-shadow:_2px_2px_0_#000] -mt-1">
                          <span className="text-orange-500">MOMENTS </span>
                          <span className="text-emerald-400">
                            {headerTitle.includes("|")
                              ? headerTitle.split("|")[1]?.trim()
                              : headerTitle.includes("\n")
                              ? headerTitle.split("\n")[1]?.trim()
                              : "FAMILY GUY"}
                          </span>
                        </p>
                        <div className="mt-2 text-left pl-4 text-[11px] font-black space-y-0.5">
                          <p className="text-yellow-400">
                            1. <span className="text-white truncate inline-block max-w-[200px] align-bottom">
                              {editableClips.find((c) => String(c.id) === activeCutClipId)?.rank_title || "Active Moment"}
                            </span>
                          </p>
                        </div>
                      </div>

                      {/* 16:9 Video Container */}
                      <div className="absolute top-[37.5%] w-full aspect-video bg-black border-y-2 border-amber-500/30 overflow-hidden shadow-2xl z-10 flex items-center justify-center">
                        <video
                          ref={videoRef}
                          id="review-player-video"
                          key={activePreviewUrl || "preview-16-9"}
                          src={activePreviewUrl}
                          playsInline
                          onTimeUpdate={handleTimeUpdate}
                          onLoadedMetadata={handleLoadedMetadata}
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      {/* Bottom Area */}
                      <div className="absolute bottom-4 left-0 right-0 px-3 text-center pointer-events-none z-20">
                        {channelHandle && (
                          <p className="text-xs font-bold text-slate-200/90 uppercase tracking-wider transform -skew-x-12 drop-shadow [text-shadow:_1px_1px_0_#000]">
                            {channelHandle}
                          </p>
                        )}
                        {captionsEnabled ? (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-amber-300 font-mono border border-amber-500/30">
                            Karaoke Subtitles (1-2 lines)
                          </span>
                        ) : (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] text-slate-500 font-mono border border-slate-700/40">
                            Subtitles OFF
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      id="review-player-video"
                      key={activePreviewUrl}
                      src={activePreviewUrl}
                      controls={playerMode === "final"}
                      playsInline
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      className="w-full h-full object-cover"
                    />
                  )}
                </>
              ) : (
                <div className="text-center p-6 text-slate-500">
                  <Film className="w-10 h-10 mx-auto mb-2 text-indigo-400/60" />
                  <p className="text-xs font-medium text-slate-300">Ready to Render</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Select candidate moments or click Instant Cut Preview to test cuts.
                  </p>
                </div>
              )}
            </div>

            {/* Instant Cut Transport Controls (Only in Cut Mode) */}
            {playerMode === "cut" && activeCutRange && (
              <div className="w-full mt-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
                  <span className="text-amber-400 font-bold">
                    Cut Progress: {(Math.max(0, playerCurrentTime - activeCutRange.start)).toFixed(1)}s / {(activeCutRange.end - activeCutRange.start).toFixed(1)}s
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    Video: {playerCurrentTime.toFixed(1)}s
                  </span>
                </div>

                {/* Range Scrubber */}
                <input
                  type="range"
                  min={activeCutRange.start}
                  max={activeCutRange.end}
                  step="0.05"
                  value={Math.max(activeCutRange.start, Math.min(playerCurrentTime, activeCutRange.end))}
                  onChange={(e) => {
                    const targetTime = parseFloat(e.target.value);
                    if (videoRef.current) {
                      videoRef.current.currentTime = targetTime;
                      setPlayerCurrentTime(targetTime);
                    }
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />

                {/* Transport Buttons */}
                <div className="flex items-center justify-between pt-1 gap-1">
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    className="p-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold transition flex items-center justify-center cursor-pointer"
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  </button>

                  <button
                    type="button"
                    onClick={handleJumpToStart}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                    title="Jump to Cut Start"
                  >
                    ⏮ Start
                  </button>

                  <button
                    type="button"
                    onClick={handleJumpToEndHook}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                    title="Jump to 2.5s before end to test cut transition"
                  >
                    ⏭ End (-2.5s)
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLoopingCut((prev) => !prev)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                      isLoopingCut
                        ? "bg-indigo-600/30 border border-indigo-500/40 text-indigo-300"
                        : "bg-slate-800 text-slate-400"
                    }`}
                    title="Toggle cut loop"
                  >
                    <Repeat className="w-3 h-3" />
                    Loop {isLoopingCut ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            )}

            {/* Visual Design Layer Specs */}
            <div className="w-full mt-4 bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 text-[11px] space-y-1.5 text-slate-400">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium">Layout Mode:</span>
                <span className="text-amber-400 font-bold">
                  {layoutMode === "1:1" ? "1:1 Square (Blurred BG)" : layoutMode === "16:9" ? "16:9 Full Ratio (Blurred BG)" : "9:16 Full Screen Vertical"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium">Layer 1 (Top):</span>
                <span className="text-amber-400 font-bold">Anton Italic Title Hook</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium">Layer 2 (Middle):</span>
                <span className="text-indigo-300 font-medium">Dynamic Sequential Rank Reveal</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium">Layer 3 (Bottom):</span>
                <span className={captionsEnabled ? "text-emerald-300 font-mono" : "text-slate-500 font-mono"}>
                  {captionsEnabled ? "ASS Karaoke (Compact 1-2 Lines) + Watermark" : "Disabled (Clean Video) + Watermark"}
                </span>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="w-full mt-4 flex flex-wrap gap-2">
              {job.final_video_url && (
                <>
                  <button
                    onClick={handlePreviewFinalShort}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                      playerMode === "final"
                        ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                        : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Play Final Short
                  </button>

                  <a
                    href={job.final_video_url}
                    download={`ranked_short_${job.id}.mp4`}
                    className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .mp4
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive Customizer, Candidate Selector, & Render Studio */}
        <div className="lg:col-span-7 space-y-6">
          {/* SECTION 1: Viral Ranking Template & Layout Customizer */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                  Viral Ranking Template & Layout Modes
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Choose video frame framing and customize hook title banner.
                </p>
              </div>
              <span className="text-[10px] font-mono uppercase bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-bold">
                Viral Template
              </span>
            </div>

            {/* Layout Mode Selector (1:1 Square Blur vs 16:9 Full Ratio Blur vs 9:16 Vertical) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Video Frame Mode (Canvas: 9:16 Vertical 1080x1920)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setLayoutMode("1:1")}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    layoutMode === "1:1"
                      ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 border-2 border-amber-400 rounded-sm inline-block" />
                      1:1 Square
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                      Template Default
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Square video centered, rest of canvas filled with blurred background.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setLayoutMode("16:9")}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    layoutMode === "16:9"
                      ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="w-4 h-2.5 border-2 border-indigo-400 rounded-sm inline-block" />
                      16:9 Full Ratio
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Uncropped widescreen video with blurred video background top & bottom.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setLayoutMode("9:16")}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    layoutMode === "9:16"
                      ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className="w-2.5 h-4 border-2 border-emerald-400 rounded-sm inline-block" />
                      9:16 Full Screen
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Full vertical crop covering entire 1080x1920 canvas.
                  </p>
                </button>
              </div>
            </div>

            {/* Template Type Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Template Style
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setTemplateType("ranking")}
                  className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                    templateType === "ranking"
                      ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      Viral Ranking
                    </span>
                    {templateType === "ranking" && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Animated countdown 1–5 with rank reveal overlay & swoosh sound.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTemplateType("single_title")}
                  className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                    templateType === "single_title"
                      ? "bg-indigo-500/15 border-indigo-500/60 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-indigo-400" />
                      Single Title
                    </span>
                    {templateType === "single_title" && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    One clean hook title at the top + karaoke captions. No rank list.
                  </p>
                </button>
              </div>
            </div>

            {/* Captions / Subtitles Toggle */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Subtitles className="w-3.5 h-3.5 text-amber-400" />
                  Karaoke Captions (Layer 3)
                </label>
                <span className="text-[10px] text-slate-400">
                  {captionsEnabled ? "Compact 1–2 Lines Max (Punchy)" : "Captions Disabled"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setCaptionsEnabled(true)}
                  className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    captionsEnabled
                      ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500 text-white"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${captionsEnabled ? "bg-amber-500/20 text-amber-400" : "bg-slate-900 text-slate-500"}`}>
                      <Subtitles className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold block text-white">Captions ON</span>
                      <span className="text-[11px] text-slate-400 block">Compact 3–4 words, never obscures video</span>
                    </div>
                  </div>
                  {captionsEnabled && <Check className="w-4 h-4 text-amber-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => setCaptionsEnabled(false)}
                  className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    !captionsEnabled
                      ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500 text-white"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-400"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${!captionsEnabled ? "bg-amber-500/20 text-amber-400" : "bg-slate-900 text-slate-500"}`}>
                      <Subtitles className="w-4 h-4 opacity-40" />
                    </div>
                    <div>
                      <span className="text-xs font-bold block text-white">Captions OFF</span>
                      <span className="text-[11px] text-slate-400 block">Clean visuals without burned subtitles</span>
                    </div>
                  </div>
                  {!captionsEnabled && <Check className="w-4 h-4 text-amber-400" />}
                </button>
              </div>
            </div>

            {/* Inputs Grid: Title & Watermark */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="header-title-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Title Hook Banner (Use \n or | for Line 1 & Line 2)
                </label>
                <input
                  id="header-title-input"
                  type="text"
                  value={headerTitle}
                  onChange={(e) => setHeaderTitle(e.target.value)}
                  placeholder="RANKING BEST RANDOM | MOMENTS FAMILY GUY"
                  className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-bold text-amber-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 tracking-wide"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Channel Watermark Handle
                </label>
                <input
                  type="text"
                  value={channelHandle}
                  onChange={(e) => setChannelHandle(e.target.value)}
                  placeholder="@MalsTheDev"
                  className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Live Template Visual Preview */}
            <div className="pt-2">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1.5 font-semibold">
                Live Template Preview
              </span>
              <div className="w-full bg-gradient-to-b from-slate-900/90 to-slate-950/95 rounded-2xl p-5 border border-slate-800/90 text-center relative overflow-hidden shadow-inner">
                {templateType === "single_title" ? (
                  /* Single Title Preview */
                  <div className="select-none">
                    <p className="text-xl sm:text-2xl font-black tracking-wide uppercase text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)] [text-shadow:_3px_3px_0_#000,_-2px_-2px_0_#000,_2px_-2px_0_#000,_-2px_2px_0_#000] leading-snug">
                      {headerTitle
                        .replace(/\|/g, "\n")
                        .split("\n")
                        .map((line, i) => (
                          <span key={i} className="block">{line.trim()}</span>
                        ))}
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-1.5">
                      <div className="h-px flex-1 bg-indigo-500/30" />
                      <span className="text-[10px] text-indigo-300/70 font-semibold uppercase tracking-widest">karaoke captions</span>
                      <div className="h-px flex-1 bg-indigo-500/30" />
                    </div>
                    <div className="mt-2 inline-block bg-indigo-900/40 border border-indigo-500/30 rounded-lg px-3 py-1">
                      <span className="text-xs font-bold text-white">Brian </span>
                      <span className="text-xs font-bold text-yellow-300">owes</span>
                      <span className="text-xs font-bold text-white"> Stewie</span>
                    </div>
                    {channelHandle && (
                      <p className="mt-3 text-[11px] font-bold text-slate-300/80 uppercase tracking-wider [text-shadow:_1px_1px_0_#000]">
                        {channelHandle}
                      </p>
                    )}
                  </div>
                ) : (
                  /* Ranking Template Preview */
                  <>
                    <div className="inline-block transform -skew-x-12 select-none">
                      {/* Line 1 */}
                      <p className="text-xl sm:text-2xl font-black tracking-wide uppercase drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)] [text-shadow:_3px_3px_0_#000,_-2px_-2px_0_#000,_2px_-2px_0_#000,_-2px_2px_0_#000]">
                        <span className="text-white">RANKING </span>
                        <span className="text-orange-500">BEST RANDOM</span>
                      </p>
                      {/* Line 2 */}
                      <p className="text-xl sm:text-2xl font-black tracking-wide uppercase drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)] [text-shadow:_3px_3px_0_#000,_-2px_-2px_0_#000,_2px_-2px_0_#000,_-2px_2px_0_#000] mt-1">
                        <span className="text-orange-500">MOMENTS </span>
                        <span className="text-emerald-400">
                          {headerTitle.includes("|")
                            ? headerTitle.split("|")[1]?.trim()
                            : headerTitle.includes("\n")
                            ? headerTitle.split("\n")[1]?.trim()
                            : "FAMILY GUY"}
                        </span>
                      </p>
                    </div>

                    {/* Sample Rank List Preview */}
                    <div className="mt-4 max-w-xs mx-auto text-left transform -skew-x-12 text-xs font-black space-y-1 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] [text-shadow:_2px_2px_0_#000]">
                      <p className="text-yellow-400">1. <span className="text-white">Uber Peter</span></p>
                      <p className="text-white">2.</p>
                      <p className="text-orange-500">3.</p>
                    </div>

                    {channelHandle && (
                      <p className="mt-4 text-[11px] font-bold text-slate-300/80 uppercase tracking-wider transform -skew-x-12 [text-shadow:_1px_1px_0_#000]">
                        {channelHandle}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 2: Candidate Highlights (Select & Filter) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800/80 gap-3">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-indigo-400" />
                  Candidate Highlights Extracted ({editableClips.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select 2 to 5 highlights to compile into the ranked countdown.
                </p>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectTop3}
                  className="px-2.5 py-1 text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg transition"
                >
                  Top 3 (Default)
                </button>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white transition"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-rose-400 transition"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* AI Guidance & Re-Analyze Toolbar */}
            <div className="bg-slate-950/70 border border-indigo-500/30 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Guide AI Highlight Detection
                </span>
                <span className="text-[10px] text-slate-400">
                  Instant ~3s re-analysis on cached transcript
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={aiPromptGuidance}
                  onChange={(e) => setAiPromptGuidance(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleReanalyze();
                    }
                  }}
                  placeholder='e.g. "Return all the stewie best moments" or "Find the most intense arguments"'
                  className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                />
                <button
                  type="button"
                  onClick={handleReanalyze}
                  disabled={isReanalyzing}
                  className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 text-slate-950 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10 transition cursor-pointer flex-shrink-0"
                >
                  {isReanalyzing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 fill-current" />
                      Re-analyze with AI
                    </>
                  )}
                </button>
              </div>

              {reanalyzeSuccess && (
                <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 pt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{reanalyzeSuccess}</span>
                </div>
              )}
              {reanalyzeError && (
                <div className="text-[11px] text-rose-400 flex items-center gap-1.5 pt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{reanalyzeError}</span>
                </div>
              )}
            </div>

            {/* Candidates Checkbox List */}
            <div className="space-y-3">
              {editableClips.map((clip, idx) => {
                const clipId = String(clip.id);
                const isSelected = selectedIds.includes(clipId);
                const selectedRankIndex = selectedIds.indexOf(clipId);
                const duration = (clip.end_time - clip.start_time).toFixed(1);

                return (
                  <div
                    key={clipId}
                    id={`candidate-card-${clipId}`}
                    onClick={() => toggleClipSelection(clipId)}
                    className={`p-4 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? "bg-indigo-950/40 border-indigo-500/60 shadow-md shadow-indigo-950/50"
                        : "bg-slate-950/50 border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      {/* Checkbox with Rank Number Indicator */}
                      <div className="pt-0.5">
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs transition ${
                            isSelected
                              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/40"
                              : "border border-slate-700 bg-slate-900 text-slate-500"
                          }`}
                        >
                          {isSelected ? (
                            <span>{selectedRankIndex + 1}</span>
                          ) : (
                            <span className="text-[10px]">#{idx + 1}</span>
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-sm font-bold text-white truncate">
                            {clip.rank_title || clip.title}
                          </h4>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <Flame className="w-3 h-3" />
                              {clip.score}/100
                            </span>
                          </div>
                        </div>

                        {/* Timing and Duration */}
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span className="font-mono text-slate-300">
                            {clip.start_time.toFixed(1)}s → {clip.end_time.toFixed(1)}s
                          </span>
                          <span>•</span>
                          <span className="text-indigo-300">{duration}s duration</span>
                        </div>

                        {/* Hook Sentence */}
                        {clip.hook_sentence && (
                          <p className="text-xs text-slate-300 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                            &ldquo;{clip.hook_sentence}&rdquo;
                          </p>
                        )}

                        {/* Virality Reason */}
                        {clip.virality_reason && (
                          <p className="text-[11px] text-slate-400 mt-1">
                            {clip.virality_reason}
                          </p>
                        )}
                      </div>

                      {/* Preview Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInstantPreviewCut(clip, idx);
                        }}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition self-center cursor-pointer ${
                          playerMode === "cut" && activeCutClipId === clipId
                            ? "bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20"
                            : "bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border border-slate-700/60"
                        }`}
                        title="Instant Preview Cut in Player"
                      >
                        <Zap className="w-3.5 h-3.5 fill-current" />
                        {playerMode === "cut" && activeCutClipId === clipId ? "Previewing" : "Preview Cut"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SECTION 3: Selected Clips Customizer & Reordering */}
          {orderedSelectedClips.length > 0 && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-4">
              <div className="pb-3 border-b border-slate-800/80">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-indigo-400" />
                  Customize Selected Clips & Reveal Order ({orderedSelectedClips.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Adjust ranking titles and fine-tune start/end cut times with zero-wait instant preview.
                </p>
              </div>

              <div className="space-y-4">
                {orderedSelectedClips.map((clip, index) => {
                  const clipId = String(clip.id);
                  const isCurrentPreviewing = playerMode === "cut" && activeCutClipId === clipId;
                  const duration = (clip.end_time - clip.start_time).toFixed(1);

                  return (
                    <div
                      key={clipId}
                      className={`p-4 rounded-xl space-y-3 transition border ${
                        isCurrentPreviewing
                          ? "bg-indigo-950/40 border-amber-500/60 shadow-lg shadow-indigo-950/60 ring-1 ring-amber-500/40"
                          : "bg-slate-950/70 border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-200">
                            Rank #{index + 1} Segment
                          </span>
                          {isCurrentPreviewing && (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full animate-pulse">
                              ⚡ Previewing Cut
                            </span>
                          )}
                        </div>

                        {/* Order & Instant Preview Controls */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleInstantPreviewCut(clip)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 transition cursor-pointer ${
                              isCurrentPreviewing
                                ? "bg-amber-500 text-slate-950 font-bold"
                                : "bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            <Zap className="w-3 h-3 fill-current" />
                            {isCurrentPreviewing ? "Playing" : "Preview Cut"}
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveClip(index, "up")}
                              disabled={index === 0}
                              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded disabled:opacity-30 cursor-pointer"
                              title="Move Up"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveClip(index, "down")}
                              disabled={index === orderedSelectedClips.length - 1}
                              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded disabled:opacity-30 cursor-pointer"
                              title="Move Down"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Editable Rank Title */}
                      <div>
                        <label className="block text-[10px] uppercase font-semibold text-slate-400 mb-1">
                          Rank Card Title (Revealed in Layer 2)
                        </label>
                        <input
                          type="text"
                          value={clip.rank_title || clip.title || ""}
                          onChange={(e) =>
                            updateClipField(clipId, "rank_title", e.target.value)
                          }
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      {/* Timing Fine-Tuning with Instant Seeking & Nudges */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        {/* Start Time Editor */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase font-semibold text-slate-400">
                              Start (sec)
                            </label>
                            <button
                              type="button"
                              onClick={() => handleSetFromPlayer(clipId, "start_time")}
                              className="text-[10px] text-amber-400 hover:underline cursor-pointer"
                              title="Set current video playback frame as start"
                            >
                              📌 Set Frame
                            </button>
                          </div>
                          <input
                            type="number"
                            step="0.1"
                            value={clip.start_time}
                            onChange={(e) =>
                              handleUpdateCutTime(
                                clipId,
                                "start_time",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "start_time", -1.0)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              -1s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "start_time", -0.2)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              -0.2s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "start_time", +0.2)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              +0.2s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "start_time", +1.0)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              +1s
                            </button>
                          </div>
                        </div>

                        {/* End Time Editor */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase font-semibold text-slate-400">
                              End (sec)
                            </label>
                            <button
                              type="button"
                              onClick={() => handleSetFromPlayer(clipId, "end_time")}
                              className="text-[10px] text-amber-400 hover:underline cursor-pointer"
                              title="Set current video playback frame as end"
                            >
                              📌 Set Frame
                            </button>
                          </div>
                          <input
                            type="number"
                            step="0.1"
                            value={clip.end_time}
                            onChange={(e) =>
                              handleUpdateCutTime(
                                clipId,
                                "end_time",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                          />
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "end_time", -1.0)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              -1s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "end_time", -0.2)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              -0.2s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "end_time", +0.2)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              +0.2s
                            </button>
                            <button
                              type="button"
                              onClick={() => handleNudgeCutTime(clipId, "end_time", +1.0)}
                              className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                            >
                              +1s
                            </button>
                          </div>
                        </div>

                        {/* Duration & Test Cut Action */}
                        <div className="space-y-1.5">
                          <label className="block text-[10px] uppercase font-semibold text-slate-400">
                            Duration & Test
                          </label>
                          <div className="px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs font-mono text-indigo-400 flex items-center justify-between">
                            <span>{duration}s</span>
                            <span className="text-[10px] text-slate-500">
                              {clip.start_time.toFixed(1)}s → {clip.end_time.toFixed(1)}s
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              handleInstantPreviewCut(clip);
                              setTimeout(() => handleJumpToEndHook(), 50);
                            }}
                            className="w-full py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-semibold text-slate-300 hover:text-amber-300 rounded transition cursor-pointer"
                            title="Test ending cut punchline (-2.5s)"
                          >
                            ⏭ Test End Cut (-2.5s)
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 4: Render Action Bar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-4">
            {renderError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{renderError}</span>
              </div>
            )}

            {renderSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{renderSuccess}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-400">
                  Ready to compile <span className="text-white font-bold">{orderedSelectedClips.length} clips</span> into 1080x1920 vertical ranking video.
                </p>
                <p className="text-[11px] text-slate-500">
                  High-speed FFmpeg engine with ASS karaoke subtitles and dynamic PIL overlays.
                </p>
              </div>

              <button
                type="button"
                id="render-export-btn"
                onClick={handleRenderShort}
                disabled={isRendering || orderedSelectedClips.length === 0}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 via-orange-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-slate-950 hover:text-white font-bold text-sm rounded-xl shadow-xl shadow-amber-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isRendering ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{job?.render_progress || "Rendering Short..."}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 fill-current" />
                    Render & Export Final Video
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
