"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clapperboard, Video, ArrowRight } from "lucide-react";

export default function ReviewRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/productions");
  }, [router]);

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
      <Clapperboard className="w-10 h-10 text-indigo-400 mx-auto animate-pulse" />
      <h2 className="text-base font-bold text-white">Redirecting to Productions Studio...</h2>
      <p className="text-xs text-slate-400">
        Review mode has been split into independent Sources inspection and Productions Studio.
      </p>
      <div className="flex justify-center gap-4 pt-2">
        <Link
          href="/sources"
          className="flex items-center gap-1.5 text-xs text-indigo-400 font-semibold hover:underline"
        >
          <Video className="w-3.5 h-3.5" />
          <span>Source Diagnostics</span>
        </Link>
        <Link
          href="/productions"
          className="flex items-center gap-1.5 text-xs text-purple-400 font-semibold hover:underline"
        >
          <Clapperboard className="w-3.5 h-3.5" />
          <span>Productions</span>
        </Link>
      </div>
    </div>
  );
}
