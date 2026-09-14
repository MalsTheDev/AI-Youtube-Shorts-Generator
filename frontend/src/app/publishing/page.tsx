"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Share2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Film,
  Sparkles,
  ExternalLink,
  Plus,
  Tv,
  Check,
  Play,
  UploadCloud,
  CheckCheck,
  RefreshCw,
  X,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

interface RenderedShort {
  id: string;
  header_title: string;
  selected_clip_ids: string[];
  output_file_path: string;
  video_url?: string;
  assigned_channel?: string;
  is_uploaded: boolean;
  created_at?: string;
}

interface YouTubeChannel {
  id: string;
  channel_name: string;
  credentials_json_path: string;
  has_credentials?: boolean;
  created_at?: string;
}

export default function YouTubePublishingPage() {
  const [shorts, setShorts] = useState<RenderedShort[]>([]);
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShortIds, setSelectedShortIds] = useState<string[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");

  // Metadata Form State
  const [customTitle, setCustomTitle] = useState("");
  const [description, setDescription] = useState("Watch the craziest and most hilarious moments ranked! 🔥\n\n#Shorts #Viral #Ranking #Comedy");
  const [hashtags, setHashtags] = useState("#Shorts, #Viral, #Ranking");
  const [privacyStatus, setPrivacyStatus] = useState<"public" | "unlisted" | "private">("public");

  // Add Channel Modal State
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newCredentialsPath, setNewCredentialsPath] = useState("credentials/channel_oauth.json");
  const [isAddingChannel, setIsAddingChannel] = useState(false);

  // Upload Processing State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [shortsRes, channelsRes] = await Promise.all([
        fetch("/api/shorts"),
        fetch("/api/channels"),
      ]);

      if (shortsRes.ok) {
        const shortsData = await shortsRes.json();
        setShorts(shortsData);
      }
      if (channelsRes.ok) {
        const channelsData = await channelsRes.json();
        setChannels(channelsData);
        if (channelsData.length > 0 && !selectedChannelId) {
          setSelectedChannelId(channelsData[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load publishing data:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedChannelId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toggle selection
  const toggleSelectShort = (id: string) => {
    setSelectedShortIds((prev) =>
      prev.includes(id) ? prev.filter((sId) => sId !== id) : [...prev, id]
    );
  };

  const selectAllShorts = () => {
    if (selectedShortIds.length === shorts.length) {
      setSelectedShortIds([]);
    } else {
      setSelectedShortIds(shorts.map((s) => s.id));
    }
  };

  // Add new YouTube Channel
  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    setIsAddingChannel(true);

    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_name: newChannelName.trim(),
          credentials_json_path: newCredentialsPath.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to add channel.");
      const data = await res.json();
      setChannels((prev) => [...prev, data.channel]);
      setSelectedChannelId(data.channel.id);
      setShowAddChannel(false);
      setNewChannelName("");
    } catch (err: any) {
      alert(err.message || "Could not add channel.");
    } finally {
      setIsAddingChannel(false);
    }
  };

  // Publish Selected Shorts
  const handleBatchPublish = async () => {
    if (selectedShortIds.length === 0) {
      alert("Please select at least one short to upload.");
      return;
    }
    if (!selectedChannelId) {
      alert("Please select a target YouTube channel.");
      return;
    }

    setIsUploading(true);
    setUploadSuccess(null);
    setUploadError(null);

    try {
      const uploads = selectedShortIds.map((shortId) => {
        const s = shorts.find((item) => item.id === shortId);
        const titleText = customTitle.trim()
          ? `${customTitle.trim()} - ${s?.header_title || "Viral Short"}`
          : s?.header_title || "Top Viral Ranking Short";

        return {
          short_id: shortId,
          channel_id: selectedChannelId,
          title: titleText,
          description: description.trim(),
          tags: hashtags.split(",").map((t) => t.trim()).filter(Boolean),
          privacy_status: privacyStatus,
        };
      });

      const res = await fetch("/api/shorts/batch-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploads }),
      });

      if (!res.ok) throw new Error("Batch upload request failed.");
      const data = await res.json();

      setUploadSuccess(`Successfully published ${data.results?.length || selectedShortIds.length} short(s) to YouTube!`);
      setSelectedShortIds([]);
      await fetchData();
    } catch (err: any) {
      console.error("Batch upload failed:", err);
      setUploadError(err.message || "YouTube upload processing failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClearAllShorts = async () => {
    if (!confirm("Are you sure you want to delete all rendered shorts from the database?")) return;
    try {
      await fetch("/api/shorts/clear", { method: "POST" });
      setShorts([]);
      setSelectedShortIds([]);
    } catch (err) {
      console.error("Error clearing shorts:", err);
    }
  };

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 pb-36">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <Share2 className="w-5 h-5" />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white">
                Multi-Channel YouTube Publisher
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700">
                {shorts.length} Rendered Shorts
              </span>
            </div>
            <p className="text-sm text-slate-400">
              Manage YouTube channel credentials, batch select rendered shorts, customize metadata, and publish automatically via Google OAuth.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddChannel(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 rounded-xl text-xs font-semibold transition"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Add Channel</span>
            </button>
            <button
              onClick={fetchData}
              className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-300 transition"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={handleClearAllShorts}
              className="p-2.5 bg-slate-900 border border-slate-800 hover:bg-rose-950/60 hover:border-rose-800/80 rounded-xl text-slate-400 hover:text-rose-400 transition cursor-pointer"
              title="Delete all rendered shorts from database"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notifications */}
        {uploadSuccess && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{uploadSuccess}</span>
          </div>
        )}
        {uploadError && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Two-Column Workspace Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column (8 cols): Rendered Shorts Grid */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Film className="w-4 h-4 text-indigo-400" />
                Rendered Shorts Database ({shorts.length})
              </h2>
              <button
                type="button"
                onClick={selectAllShorts}
                className="text-xs text-slate-400 hover:text-white font-semibold transition cursor-pointer"
              >
                {selectedShortIds.length === shorts.length ? "Deselect All" : `Select All (${shorts.length})`}
              </button>
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 space-y-2">
                <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
                <span className="text-xs text-slate-400 font-medium">Loading rendered shorts...</span>
              </div>
            )}

            {!loading && shorts.length === 0 && (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-3">
                <Film className="w-8 h-8 text-slate-600 mx-auto" />
                <h3 className="text-sm font-bold text-slate-300">No Rendered Shorts Yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Render a short in the Review Studio or Batch Queue to populate this library.
                </p>
                <Link
                  href="/queue"
                  className="inline-block mt-2 px-3.5 py-1.5 bg-indigo-600 rounded-lg text-xs font-bold text-white shadow"
                >
                  Generate Shorts
                </Link>
              </div>
            )}

            {/* Shorts Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {shorts.map((short) => {
                const isSelected = selectedShortIds.includes(short.id);
                return (
                  <div
                    key={short.id}
                    className={`rounded-2xl border transition-all overflow-hidden bg-slate-900/50 flex flex-col ${
                      isSelected
                        ? "border-rose-500/80 shadow-lg shadow-rose-500/10 ring-1 ring-rose-500/50"
                        : "border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    {/* Video Player Header (9:16 Aspect Preview) */}
                    <div className="relative aspect-[9/16] max-h-72 bg-black overflow-hidden flex items-center justify-center">
                      {short.video_url ? (
                        <video
                          src={short.video_url}
                          controls
                          preload="metadata"
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center p-4">
                          <Film className="w-8 h-8 text-slate-700 mx-auto mb-1" />
                          <span className="text-[10px] text-slate-500">Video preview ready</span>
                        </div>
                      )}

                      {/* Select Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleSelectShort(short.id)}
                        className={`absolute top-3 left-3 w-7 h-7 rounded-lg flex items-center justify-center transition shadow-md z-20 ${
                          isSelected
                            ? "bg-rose-500 text-white shadow-rose-500/40"
                            : "bg-slate-950/70 border border-slate-700 text-transparent hover:border-slate-500 backdrop-blur-sm"
                        }`}
                      >
                        <Check className={`w-4 h-4 stroke-[3] ${isSelected ? "text-white" : "opacity-0"}`} />
                      </button>

                      {/* Status Badge */}
                      <div className="absolute top-3 right-3 z-20">
                        {short.is_uploaded ? (
                          <span className="px-2 py-1 rounded-md bg-emerald-500/90 text-slate-950 font-black text-[10px] flex items-center gap-1 shadow">
                            <CheckCheck className="w-3 h-3" />
                            UPLOADED
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-md bg-slate-900/80 backdrop-blur-sm text-slate-300 font-bold text-[10px] border border-white/10 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-amber-400" />
                            PENDING
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Short Details */}
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div>
                        <h3 className="text-xs font-bold text-slate-100 line-clamp-2">
                          {short.header_title}
                        </h3>
                        {short.assigned_channel && (
                          <p className="text-[11px] text-indigo-400 mt-1 font-medium flex items-center gap-1">
                            <Tv className="w-3 h-3" />
                            {short.assigned_channel}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] text-slate-400">
                        <span>{short.selected_clip_ids?.length || 3} Ranked Clips</span>
                        <button
                          type="button"
                          onClick={() => toggleSelectShort(short.id)}
                          className={`font-semibold transition ${
                            isSelected ? "text-rose-400" : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {isSelected ? "Selected" : "+ Select for Upload"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column (4 cols): Channel & Publishing Metadata Form */}
          <div className="lg:col-span-4 space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-6 sticky top-24">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                <UploadCloud className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-bold text-white">Publishing Configuration</h2>
              </div>

              {/* 1. Channel Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Target YouTube Channel
                </label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.channel_name} {c.has_credentials ? "✓ (OAuth Ready)" : "(No Token)"}
                    </option>
                  ))}
                  {channels.length === 0 && <option value="">No channels added</option>}
                </select>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                  <span>{channels.length} channel{channels.length !== 1 ? "s" : ""} registered</span>
                  <button
                    type="button"
                    onClick={() => setShowAddChannel(true)}
                    className="text-indigo-400 hover:underline cursor-pointer"
                  >
                    + Add New
                  </button>
                </div>
              </div>

              {/* 2. Custom Title Prefix */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Custom Title (Optional Prefix)
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. FUNNIEST COMPILATION"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-600"
                />
                <span className="text-[10px] text-slate-500 block">
                  Leaves original ranking title if blank. Adds #Shorts automatically.
                </span>
              </div>

              {/* 3. Description */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Description Template
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500 resize-none font-mono"
                />
              </div>

              {/* 4. Hashtags & Tags */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Tags & Hashtags
                </label>
                <input
                  type="text"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="Comma-separated tags"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono text-[11px]"
                />
              </div>

              {/* 5. Privacy Status */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Publish Privacy Status
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["public", "unlisted", "private"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setPrivacyStatus(st)}
                      className={`py-2 text-xs font-bold rounded-xl border capitalize transition ${
                        privacyStatus === st
                          ? "bg-rose-500/20 border-rose-500/60 text-rose-300"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Publish CTA Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleBatchPublish}
                  disabled={isUploading || selectedShortIds.length === 0}
                  className="w-full py-3 bg-gradient-to-r from-rose-600 via-pink-600 to-amber-500 hover:from-rose-700 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Publishing to YouTube...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4" />
                      Publish {selectedShortIds.length > 0 ? `${selectedShortIds.length} Selected Short(s)` : "Shorts"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Channel Modal */}
      {showAddChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Tv className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Add YouTube Channel</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddChannel(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddChannel} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Channel Name or Handle</label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="e.g. Comedy Clips Daily @DailyComedy"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Credentials JSON Path</label>
                <input
                  type="text"
                  value={newCredentialsPath}
                  onChange={(e) => setNewCredentialsPath(e.target.value)}
                  placeholder="credentials/channel_oauth.json"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-[11px]"
                />
                <span className="text-[10px] text-slate-500 block">
                  Path to Google Cloud OAuth client credentials or token JSON.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddChannel(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingChannel}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-xs font-bold transition shadow"
                >
                  {isAddingChannel ? "Adding..." : "Save Channel"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
