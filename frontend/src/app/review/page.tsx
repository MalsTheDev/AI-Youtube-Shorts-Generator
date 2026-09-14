"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  SlidersHorizontal,
  Film,
  Play,
  ArrowRight,
  Clock,
  Sparkles,
  ExternalLink,
  Layers,
  Loader2,
  Video,
} from "lucide-react";

interface Job {
  id: string;
  url: string;
  status: string;
  header_title?: string;
  final_video_url?: string;
  num_clips?: number;
  layout_mode?: string;
  created_at?: string;
}

export default function ReviewIndexPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((data) => setJobs(data))
      .catch((e) => console.error("Error fetching jobs:", e))
      .finally(() => setLoading(false));
  }, []);

  const completedJobs = jobs.filter(
    (j) => j.status === "completed" || j.final_video_url || j.header_title
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 pb-36">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="border-b border-slate-800/80 pb-6">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <SlidersHorizontal className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-black tracking-tight text-white">
              Review & Render Studio
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700">
              {completedJobs.length} Ready Jobs
            </span>
          </div>
          <p className="text-sm text-slate-400">
            Select an extracted video job or custom compilation below to customize ranking countdown order, fine-tune cut start/end timestamps, adjust subtitle settings, and render high-impact final shorts.
          </p>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-20 space-y-2">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <span className="text-xs text-slate-400">Loading studio jobs...</span>
          </div>
        )}

        {!loading && completedJobs.length === 0 && (
          <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800 p-8 space-y-4">
            <SlidersHorizontal className="w-12 h-12 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-200">No Jobs Ready for Review</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Enqueue videos in the Batch Queue or select clips from the Clips Repository to start editing in the Review Studio.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link
                href="/queue"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow"
              >
                Go to Batch Queue
              </Link>
              <Link
                href="/clips"
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition"
              >
                Browse Clips Repository
              </Link>
            </div>
          </div>
        )}

        {/* Jobs Grid */}
        {!loading && completedJobs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {completedJobs.map((job) => (
              <div
                key={job.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 hover:border-amber-500/50 transition-all p-5 flex flex-col justify-between space-y-4 group shadow-sm"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">
                      {job.id}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold text-[10px] border border-emerald-500/20">
                      Ready for Studio
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-white line-clamp-2 group-hover:text-amber-400 transition">
                    {job.header_title || "RANKING VIRAL MOMENTS"}
                  </h3>

                  <div className="text-[11px] text-slate-400 flex items-center gap-2">
                    <span>Layout: {job.layout_mode || "1:1"}</span>
                    <span>•</span>
                    <span>{job.num_clips || 3} Moments</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {job.created_at ? new Date(job.created_at).toLocaleDateString() : "Recent"}
                  </span>
                  <Link
                    href={`/review/${job.id}`}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-slate-950 font-black text-xs rounded-xl transition shadow-md shadow-amber-500/20"
                  >
                    <span>Open Studio</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
