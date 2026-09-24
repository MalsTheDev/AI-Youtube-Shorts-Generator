"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Video, ArrowRight } from "lucide-react";

export default function ReviewJobRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params?.jobId as string;

  useEffect(() => {
    if (jobId) {
      router.replace(`/sources/${jobId}`);
    }
  }, [jobId, router]);

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
      <Video className="w-10 h-10 text-indigo-400 mx-auto animate-pulse" />
      <h2 className="text-base font-bold text-white">Redirecting to Source Diagnostics...</h2>
      <p className="text-xs text-slate-400">
        Source #{jobId} diagnostics and transcript viewer.
      </p>
      {jobId && (
        <Link
          href={`/sources/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-indigo-400 font-semibold hover:underline"
        >
          <span>Click here if not redirected automatically</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}
