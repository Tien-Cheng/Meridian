"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface ActivityLogProps {
  investigationId: Id<"investigations">;
}

export default function ActivityLog({
  investigationId,
}: ActivityLogProps) {
  const agents =
    useQuery(api.functions.monitor.listByInvestigation, {
      investigationId,
    }) ?? [];

  // Derive log entries from agent monitor updates
  const entries = agents
    .map((a) => ({
      time: a.updatedAt,
      text: `[${a.marketplace}] ${a.statusLabel}`,
      status: a.status,
    }))
    .sort((a, b) => b.time - a.time);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
        <h4 className="text-zinc-500 font-mono text-xs tracking-wider">
          ACTIVITY
        </h4>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
        {entries.length === 0 ? (
          <p className="text-zinc-700 font-mono text-xs">Waiting...</p>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-zinc-700 font-mono text-xs shrink-0">
                {new Date(entry.time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span
                className={`font-mono text-xs ${
                  entry.status === "error"
                    ? "text-red-400"
                    : entry.status === "completed"
                      ? "text-emerald-400"
                      : "text-zinc-400"
                }`}
              >
                {entry.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
