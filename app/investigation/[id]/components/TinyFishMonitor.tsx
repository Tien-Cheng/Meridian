"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface TinyFishMonitorProps {
  investigationId: Id<"investigations">;
}

export default function TinyFishMonitor({
  investigationId,
}: TinyFishMonitorProps) {
  const agents =
    useQuery(api.functions.monitor.listByInvestigation, {
      investigationId,
    }) ?? [];

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center w-full">
        <p className="text-zinc-600 font-mono text-xs">
          TinyFish agents will appear here when investigation starts.
        </p>
      </div>
    );
  }

  return (
    <>
      {agents.map((agent) => (
        <div
          key={agent._id}
          className={`flex-shrink-0 w-[240px] bg-zinc-900 border border-zinc-800 flex flex-col ${
            agent.status === "completed"
              ? "border-l-2 border-l-emerald-500"
              : agent.status === "error"
                ? "border-l-2 border-l-red-500"
                : "border-l-2 border-l-amber-500"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-zinc-300 font-mono text-xs font-bold uppercase truncate">
              {agent.marketplace}
            </span>
            {agent.status !== "completed" && agent.status !== "error" && (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-red-500 animate-pulse" />
                <span className="text-red-500 font-mono text-xs font-bold">
                  LIVE
                </span>
              </span>
            )}
          </div>

          {/* Screenshot / content area */}
          <div className="flex-1 bg-zinc-950 flex items-center justify-center">
            {agent.screenshotUrl ? (
              <img
                src={agent.screenshotUrl}
                alt={`Agent ${agent.agentIndex} screenshot`}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-zinc-700 font-mono text-xs">
                {agent.region}
              </span>
            )}
          </div>

          {/* Status */}
          <div className="px-3 py-2 border-t border-zinc-800">
            <p className="text-zinc-500 font-mono text-xs truncate">
              {agent.statusLabel}
            </p>
          </div>
        </div>
      ))}
    </>
  );
}
