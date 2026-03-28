"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import dynamic from "next/dynamic";
import RightPanel from "./components/RightPanel";
import TinyFishMonitor from "./components/TinyFishMonitor";
import ActivityLog from "./components/ActivityLog";

// deck.gl/mapbox must be client-only
const InvestigationMap = dynamic(
  () => import("./components/InvestigationMap"),
  { ssr: false }
);

export default function InvestigationPage() {
  const { id } = useParams();
  const investigationId = id as Id<"investigations">;

  const investigation = useQuery(api.functions.investigations.get, {
    id: investigationId,
  });

  if (!investigation) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <p className="text-zinc-500 font-mono text-sm animate-pulse">
          LOADING INVESTIGATION...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 header-glow bg-zinc-950 shrink-0">
        <Link
          href="/"
          className="font-mono font-bold text-amber-500 tracking-widest text-sm hover:text-amber-400 transition-colors"
        >
          MERIDIAN
        </Link>
        <span className="text-zinc-700 font-mono">·</span>
        <span className="text-zinc-400 font-mono text-xs">
          INV-{investigation._id.slice(-8).toUpperCase()}
        </span>
        <span className="text-zinc-700 font-mono">·</span>
        <span className="text-zinc-400 font-mono text-xs">
          {investigation.drugName || "UNTITLED"}
          {investigation.drugCategory && ` ${investigation.drugCategory}`}
        </span>
        <span className="text-zinc-700 font-mono">·</span>
        <InvestigationStatus status={investigation.status} />
      </header>

      {/* Main content: map + right panel */}
      <div className="flex-1 flex min-h-0">
        {/* Map area */}
        <div className="flex-1 relative grid-texture">
          <InvestigationMap investigationId={investigationId} />
        </div>

        {/* Right panel */}
        <div className="w-[420px] border-l border-zinc-800 flex flex-col">
          <RightPanel
            investigationId={investigationId}
            threadId={investigation.threadId}
            investigationStatus={investigation.status}
          />
        </div>
      </div>

      {/* Bottom bar: TinyFish monitor + activity log */}
      <div className="h-[180px] border-t border-zinc-800 flex shrink-0">
        <div className="flex-1 flex gap-2 p-3 overflow-x-auto">
          <TinyFishMonitor investigationId={investigationId} />
        </div>
        <div className="w-[300px] border-l border-zinc-800">
          <ActivityLog investigationId={investigationId} />
        </div>
      </div>
    </div>
  );
}

function InvestigationStatus({ status }: { status: string }) {
  const label = status.toUpperCase().replace("_", " ");
  const dotColor =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "pending"
          ? "bg-zinc-500"
          : "bg-amber-500 animate-pulse";

  return (
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 ${dotColor}`} />
      <span className="text-zinc-400 font-mono text-xs">{label}</span>
    </span>
  );
}
