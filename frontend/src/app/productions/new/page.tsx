"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Clapperboard,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Layers,
} from "lucide-react";

function NewProductionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const clipIdsParam = searchParams.get("clip_ids") || "";
  const initialClipIds = clipIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const [title, setTitle] = useState("TOP VIRAL MOMENTS");
  const [template, setTemplate] = useState("ranking");
  const [layoutMode, setLayoutMode] = useState("1:1");
  const [transitionType, setTransitionType] = useState("swoosh");
  const [countdownOrder, setCountdownOrder] = useState(true);
  const [fontFamily, setFontFamily] = useState("anton");
  const [channelHandle, setChannelHandle] = useState("");
  const [captionFont, setCaptionFont] = useState("dejavu");
  const [captionSize, setCaptionSize] = useState("54");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          template,
          aspect_ratio: "9:16",
          layout_mode: layoutMode,
          transition_type: transitionType,
          countdown_order: countdownOrder,
          font_family: fontFamily,
          channel_handle: channelHandle.trim(),
          caption_settings: {
            font: captionFont,
            size: captionSize,
            animation: "karaoke",
            primary_color: "&H00FFFF&",
            back_color: "&H80000000&",
          },
          initial_clip_ids: initialClipIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create production.");
      }

      const data = await res.json();
      router.push(`/productions/${data.id}`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to initialize production.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/productions"
          className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-zinc-400" />
            <span>New Shorts Production</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure composition settings, ranking mode, and subtitle typography.
          </p>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-sm space-y-5">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
              Production Title (Header Overlay)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. TOP 5 FUNNIEST MOMENTS"
              className="w-full px-4 py-2.5 text-sm bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 font-semibold focus:outline-none focus:border-zinc-500 transition"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Template Preset
              </label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
              >
                <option value="ranking">Ranking Template (#N ... #1 Countdown)</option>
                <option value="single_title">Single Title Template (Persistent Header)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Aspect & Video Layout
              </label>
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
              >
                <option value="1:1">1:1 Square (Shorts layout with header & captions)</option>
                <option value="9:16">9:16 Full Screen Crop</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Transition Between Clips
            </label>
            <select
              value={transitionType}
              onChange={(e) => setTransitionType(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
            >
              <option value="swoosh">Swoosh Audio & Reveal</option>
              <option value="black_screen">Black Cut with core.mp3</option>
              <option value="crossfade">Smooth Crossfade</option>
              <option value="cut">Direct Hard Cut</option>
            </select>
          </div>

          {template === "ranking" && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Rank Numbering Direction
              </label>
              <select
                value={countdownOrder ? "countdown" : "ascending"}
                onChange={(e) => setCountdownOrder(e.target.value === "countdown")}
                className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
              >
                <option value="countdown">Countdown (#5 → #1, Reverse Order - Classic Viral)</option>
                <option value="ascending">Ascending (#1 → #5, Forward Order)</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Font & Typography Style
            </label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
            >
              <option value="anton">Meme / Bold Impact (Anton - Sheared Viral Style)</option>
              <option value="minimal">Minimal Sans (Inter - Clean Modern)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Caption Subtitle Font
              </label>
              <select
                value={captionFont}
                onChange={(e) => setCaptionFont(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
              >
                <option value="dejavu">Classic V1 Style (DejaVu Sans)</option>
                <option value="anton">Meme Style (Anton - Bold Impact)</option>
                <option value="montserrat">Viral Heavy (Montserrat Black)</option>
                <option value="inter">Modern Clean (Inter Bold)</option>
                <option value="liberation">Standard Bold (Liberation Sans)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Caption Font Size
              </label>
              <select
                value={captionSize}
                onChange={(e) => setCaptionSize(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 focus:outline-none focus:border-zinc-500 transition"
              >
                <option value="54">V1 Classic (54pt)</option>
                <option value="60">Medium (60pt)</option>
                <option value="70">Large (70pt)</option>
                <option value="80">Extra Large (80pt)</option>
                <option value="46">Compact (46pt)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center justify-between">
              <span>Channel Tag / Watermark (@handle)</span>
              <span className="text-[10px] text-zinc-500 font-normal">Shows at bottom of video</span>
            </label>
            <input
              type="text"
              value={channelHandle}
              onChange={(e) => setChannelHandle(e.target.value)}
              placeholder="@malshorts"
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono transition"
            />
          </div>

          {initialClipIds.length > 0 && (
            <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs flex items-center gap-2">
              <Layers className="w-4 h-4 shrink-0 text-zinc-400" />
              <span>
                {initialClipIds.length} clip(s) pre-selected from repository. You can reorder and add more inside the studio!
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Link
              href="/productions"
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-zinc-100 hover:bg-white disabled:opacity-50 text-zinc-950 font-semibold text-xs shadow-sm transition active:scale-[0.98]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating Studio...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Launch Production Studio</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function NewProductionPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto px-4 py-24 flex justify-center text-zinc-500">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      }
    >
      <NewProductionContent />
    </Suspense>
  );
}
