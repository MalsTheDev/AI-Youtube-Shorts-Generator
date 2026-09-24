"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Layers,
  LayoutDashboard,
  Video,
  Film,
  Clapperboard,
  Tv,
  Share2,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
  FileVideo,
  Scissors,
  Sparkles,
  Trash2,
} from "lucide-react";

interface ManualCut {
  title: string;
  start_time: string;
  end_time: string;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [ingestTab, setIngestTab] = useState<"youtube" | "upload">("youtube");

  // YouTube tab state
  const [urlsInput, setUrlsInput] = useState("");
  const [category, setCategory] = useState("Family Guy");
  const [targetDuration, setTargetDuration] = useState("Auto");

  // Upload tab state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadType, setUploadType] = useState<"single" | "episode">("single");
  const [episodeSubMode, setEpisodeSubMode] = useState<"manual" | "ai">("manual");
  const [manualCuts, setManualCuts] = useState<ManualCut[]>([
    { title: "Highlight #1", start_time: "00:00:10", end_time: "00:00:45" },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  React.useEffect(() => {
    const handleOpen = (e: any) => {
      if (e.detail?.tab) {
        setIngestTab(e.detail.tab);
      }
      setIsModalOpen(true);
    };
    window.addEventListener("open-ingest-modal", handleOpen);
    return () => window.removeEventListener("open-ingest-modal", handleOpen);
  }, []);

  const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard, isActive: pathname === "/" },
    { label: "Sources", href: "/sources", icon: Video, isActive: pathname.startsWith("/sources") },
    { label: "Clips Library", href: "/clips", icon: Film, isActive: pathname.startsWith("/clips") },
    { label: "Productions", href: "/productions", icon: Clapperboard, isActive: pathname.startsWith("/productions") },
    { label: "Renders", href: "/renders", icon: Tv, isActive: pathname.startsWith("/renders") },
    { label: "Publishing", href: "/publishing", icon: Share2, isActive: pathname.startsWith("/publishing") },
  ];

  const addCutRow = () => {
    setManualCuts((prev) => [
      ...prev,
      { title: `Highlight #${prev.length + 1}`, start_time: "00:01:00", end_time: "00:01:45" },
    ]);
  };

  const removeCutRow = (index: number) => {
    setManualCuts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateCutRow = (index: number, field: keyof ManualCut, val: string) => {
    setManualCuts((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (ingestTab === "youtube") {
      const urls = urlsInput
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0);

      if (urls.length === 0) {
        setErrorMsg("Please enter at least one valid YouTube URL.");
        return;
      }

      setIsSubmitting(true);
      try {
        const res = await fetch("/api/sources/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            urls,
            youtube_url: urls[0],
            category,
            target_duration: targetDuration,
            layout_mode: "1:1",
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Failed to enqueue sources.");
        }

        const data = await res.json();
        setSuccessMsg(`Enqueued ${data.count || urls.length} video(s) for processing!`);
        setUrlsInput("");
        setTimeout(() => {
          setIsModalOpen(false);
          setSuccessMsg(null);
          router.push("/sources");
        }, 1000);
      } catch (err: any) {
        setErrorMsg(err.message || "An unexpected error occurred.");
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Local file upload tab
      if (!uploadFile) {
        setErrorMsg("Please select a video file (.mp4, .mov, etc.) to upload.");
        return;
      }

      setIsSubmitting(true);
      try {
        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("category", category);
        if (uploadTitle.trim()) formData.append("title", uploadTitle.trim());

        let mode = "single_clip";
        if (uploadType === "episode") {
          mode = episodeSubMode === "manual" ? "manual_cuts" : "ai_discovery";
          if (episodeSubMode === "manual") {
            formData.append("cuts_json", JSON.stringify(manualCuts));
          }
        }
        formData.append("mode", mode);

        const res = await fetch("/api/sources/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Failed to upload video.");
        }

        const data = await res.json();
        setSuccessMsg("Video uploaded successfully!");
        setUploadFile(null);
        setUploadTitle("");

        setTimeout(() => {
          setIsModalOpen(false);
          setSuccessMsg(null);
          if (data.redirect_url) {
            router.push(data.redirect_url);
          } else {
            router.push(mode === "single_clip" ? "/clips" : "/sources");
          }
        }, 1000);
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to upload and process video.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700/80 flex items-center justify-center group-hover:border-zinc-500 transition">
              <Layers className="w-4 h-4 text-zinc-100" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
                AI SHORTS <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 font-semibold border border-zinc-700">STUDIO</span>
              </span>
              <span className="text-[10px] text-zinc-400 font-medium tracking-wide block -mt-0.5">
                Multi-Clip Discovery & Rendering
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800/80">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    item.isActive
                      ? "bg-zinc-800 text-white shadow-sm font-semibold"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Action Button & Status */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add Video</span>
            </button>
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 text-[11px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Engine Ready
            </div>
          </div>
        </div>
      </header>

      {/* Global Ingestion & Upload Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Add Video to Studio</h3>
                <p className="text-xs text-zinc-400">Ingest via YouTube link or upload local MP4/MOV episode</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Ingestion Mode Switcher */}
            <div className="grid grid-cols-2 p-1 bg-zinc-950 rounded-xl border border-zinc-800 text-xs">
              <button
                type="button"
                onClick={() => setIngestTab("youtube")}
                className={`py-2 rounded-lg font-medium transition flex items-center justify-center gap-2 ${
                  ingestTab === "youtube"
                    ? "bg-zinc-800 text-white font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>YouTube URLs</span>
              </button>
              <button
                type="button"
                onClick={() => setIngestTab("upload")}
                className={`py-2 rounded-lg font-medium transition flex items-center justify-center gap-2 ${
                  ingestTab === "upload"
                    ? "bg-zinc-800 text-white font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Upload Video File</span>
              </button>
            </div>

            <form onSubmit={handleIngest} className="space-y-4">
              {ingestTab === "youtube" ? (
                /* YouTube Tab */
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      YouTube URLs <span className="text-zinc-500">(one per line or comma-separated)</span>
                    </label>
                    <textarea
                      value={urlsInput}
                      onChange={(e) => setUrlsInput(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=...&#10;https://youtu.be/..."
                      rows={3}
                      className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
                      required={ingestTab === "youtube"}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">Category</label>
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500"
                      >
                        <option value="Family Guy">Family Guy</option>
                        <option value="Modern Family">Modern Family</option>
                        <option value="Comedy">Comedy</option>
                        <option value="Podcast">Podcast</option>
                        <option value="General">General</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-300 mb-1.5">Target Duration</label>
                      <select
                        value={targetDuration}
                        onChange={(e) => setTargetDuration(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500"
                      >
                        <option value="Auto">Auto (Smart AI Cut)</option>
                        <option value="30">~30 seconds</option>
                        <option value="45">~45 seconds</option>
                        <option value="60">~60 seconds</option>
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                /* Local Upload Tab with 3 Options */
                <div className="space-y-4">
                  {/* File Selector */}
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Select Video File <span className="text-zinc-500">(.mp4, .mov, .mkv, .webm)</span>
                    </label>
                    <label className="flex flex-col items-center justify-center p-4 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl bg-zinc-950 cursor-pointer transition">
                      <FileVideo className="w-6 h-6 text-zinc-400 mb-1.5" />
                      <span className="text-xs text-zinc-300 font-medium">
                        {uploadFile ? uploadFile.name : "Click or drag video file here"}
                      </span>
                      {uploadFile && (
                        <span className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {(uploadFile.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                      )}
                      <input
                        type="file"
                        accept="video/*,.mp4,.mov,.mkv,.webm"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setUploadFile(e.target.files[0]);
                          }
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">Video Title (Optional)</label>
                    <input
                      type="text"
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      placeholder="e.g. Modern Family Season 2 Episode 4"
                      className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  {/* 3 User Options Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-zinc-300">
                      Processing Mode:
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setUploadType("single")}
                        className={`p-3 rounded-xl border text-left transition ${
                          uploadType === "single"
                            ? "bg-zinc-800/80 border-zinc-600 text-white"
                            : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <Film className="w-3.5 h-3.5" />
                          <span>Single Clip</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1 leading-tight">
                          Import full video as 1 editable clip in the Clips Library
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setUploadType("episode")}
                        className={`p-3 rounded-xl border text-left transition ${
                          uploadType === "episode"
                            ? "bg-zinc-800/80 border-zinc-600 text-white"
                            : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <Video className="w-3.5 h-3.5" />
                          <span>Full Episode / Video</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1 leading-tight">
                          Long video to extract multiple clips from
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* If Full Episode selected: Sub-options (Manual Timestamp Cuts vs AI Discovery) */}
                  {uploadType === "episode" && (
                    <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
                      <label className="block text-xs font-semibold text-zinc-300">
                        Episode Extraction Method:
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEpisodeSubMode("manual")}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold border text-center transition ${
                            episodeSubMode === "manual"
                              ? "bg-zinc-800 border-zinc-600 text-white"
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                          }`}
                        >
                          Cut Specific Moments
                        </button>
                        <button
                          type="button"
                          onClick={() => setEpisodeSubMode("ai")}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold border text-center transition ${
                            episodeSubMode === "ai"
                              ? "bg-zinc-800 border-zinc-600 text-white"
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                          }`}
                        >
                          AI Auto Discovery
                        </button>
                      </div>

                      {episodeSubMode === "manual" ? (
                        <div className="space-y-2 pt-2 border-t border-zinc-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400 font-medium">Define Clip Timestamps:</span>
                            <button
                              type="button"
                              onClick={addCutRow}
                              className="text-xs text-zinc-300 hover:text-white font-semibold flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Cut</span>
                            </button>
                          </div>

                          <div className="space-y-2">
                            {manualCuts.map((cut, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs"
                              >
                                <input
                                  type="text"
                                  value={cut.title}
                                  onChange={(e) => updateCutRow(idx, "title", e.target.value)}
                                  placeholder="Clip title"
                                  className="flex-1 px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none"
                                />
                                <div className="flex items-center gap-1 font-mono text-[11px]">
                                  <input
                                    type="text"
                                    value={cut.start_time}
                                    onChange={(e) => updateCutRow(idx, "start_time", e.target.value)}
                                    placeholder="00:26:32"
                                    className="w-20 px-1.5 py-1 text-center bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none"
                                    title="Start Time (HH:MM:SS or seconds)"
                                  />
                                  <span className="text-zinc-500">-</span>
                                  <input
                                    type="text"
                                    value={cut.end_time}
                                    onChange={(e) => updateCutRow(idx, "end_time", e.target.value)}
                                    placeholder="00:27:50"
                                    className="w-20 px-1.5 py-1 text-center bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none"
                                    title="End Time (HH:MM:SS or seconds)"
                                  />
                                </div>
                                {manualCuts.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeCutRow(idx)}
                                    className="p-1 text-zinc-500 hover:text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 space-y-1">
                          <span className="font-semibold text-zinc-200 block">AI Speech Highlight Discovery:</span>
                          <p className="text-[11px] text-zinc-400">
                            Whisper will transcribe speech and AI will identify 5-10 viral clips with virality scores. Zero auto-rendering.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 font-bold text-xs shadow-sm transition"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <span>{ingestTab === "youtube" ? "Enqueue Sources" : "Upload Video"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
