"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Video, ArrowRight } from "lucide-react";

export default function QueueRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/sources");
  }, [router]);

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
      <Video className="w-10 h-10 text-indigo-400 mx-auto animate-pulse" />
      <h2 className="text-base font-bold text-white">Redirecting to Sources Studio...</h2>
      <p className="text-xs text-slate-400">
        The queue has been upgraded to the decoupled Sources Management Studio.
      </p>
      <Link
        href="/sources"
        className="inline-flex items-center gap-1.5 text-xs text-indigo-400 font-semibold hover:underline"
      >
        <span>Click here if not redirected automatically</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
