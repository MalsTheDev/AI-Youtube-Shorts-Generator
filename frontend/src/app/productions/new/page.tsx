"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Clapperboard,
  ArrowLeft,
  Sparkles,
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
          clip_ids: initialClipIds,
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
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
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
            <span>New Shorts Production</span>
          </h1>
          <p className="text-xs text-slate-400">
            Set up the foundation for your new multi-clip Short composition.
          </p>
        </div>
      </div>

      <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-5">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Production Title (Header Overlay)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. TOP 5 FUNNIEST MOMENTS"
              className="w-full px-4 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white font-bold focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Template Preset
              </label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full px-3 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ranking">Ranking Template (#N ... #1 Countdown)</option>
                <option value="single_title">Single Title Template (Persistent Header)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Aspect & Video Layout
              </label>
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value)}
                className="w-full px-3 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="1:1">1:1 Square (Shorts layout with header & captions)</option>
                <option value="9:16">9:16 Full Screen Crop</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Transition Between Clips
            </label>
            <select
              value={transitionType}
              onChange={(e) => setTransitionType(e.target.value)}
              className="w-full px-3 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="swoosh">Swoosh Audio & Reveal</option>
              <option value="crossfade">Smooth Crossfade</option>
              <option value="cut">Direct Hard Cut</option>
            </select>
          </div>

          {initialClipIds.length > 0 && (
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs flex items-center gap-2">
              <Layers className="w-4 h-4 shrink-0" />
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
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition hover:scale-105"
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
        <div className="max-w-2xl mx-auto px-4 py-24 flex justify-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <NewProductionContent />
    </Suspense>
  );
}
