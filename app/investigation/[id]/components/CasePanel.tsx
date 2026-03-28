"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface CasePanelProps {
  investigationId: Id<"investigations">;
}

export default function CasePanel({ investigationId }: CasePanelProps) {
  const caseFile = useQuery(api.functions.cases.getByInvestigation, {
    investigationId,
  });

  if (!caseFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-zinc-600 font-mono text-xs">
          Case file will be generated after investigation completes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-6">
      {/* Title */}
      <div>
        <h2 className="text-zinc-100 font-mono text-sm font-bold">
          {caseFile.title}
        </h2>
        <p className="text-zinc-500 font-mono text-xs mt-1">
          Generated {new Date(caseFile.generatedAt).toLocaleString()}
        </p>
      </div>

      {/* Executive Summary */}
      <section>
        <h3 className="text-zinc-500 font-mono text-xs tracking-wider mb-2">
          EXECUTIVE SUMMARY
        </h3>
        <p className="text-zinc-300 font-mono text-xs leading-relaxed">
          {caseFile.executiveSummary}
        </p>
      </section>

      {/* Key Statistics */}
      <section>
        <h3 className="text-zinc-500 font-mono text-xs tracking-wider mb-2">
          KEY STATISTICS
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="LISTINGS FOUND"
            value={caseFile.totalListingsFound}
          />
          <StatCard
            label="SUSPICIOUS"
            value={caseFile.suspiciousListings}
            color="text-amber-400"
          />
          <StatCard
            label="VERIFIED VIOLATIONS"
            value={caseFile.verifiedViolations}
            color="text-red-500"
          />
          <StatCard
            label="SELLER CLUSTERS"
            value={caseFile.sellerClustersIdentified}
          />
        </div>
      </section>

      {/* Recommended Actions */}
      <section>
        <h3 className="text-zinc-500 font-mono text-xs tracking-wider mb-2">
          RECOMMENDED ACTIONS
        </h3>
        <div className="flex flex-col gap-2">
          {caseFile.recommendedActions.map((action, i) => (
            <div
              key={i}
              className="bg-zinc-900 border border-zinc-800 p-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <PriorityBadge priority={action.priority} />
                <span className="text-zinc-100 font-mono text-xs font-bold">
                  {action.action}
                </span>
              </div>
              <p className="text-zinc-400 font-mono text-xs">
                {action.detail}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-zinc-100",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 p-3">
      <p className="text-zinc-500 font-mono text-xs">{label}</p>
      <p className={`${color} font-mono text-lg font-bold`}>{value}</p>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const color =
    priority === "high"
      ? "text-red-500 border-red-500/30"
      : priority === "medium"
        ? "text-amber-400 border-amber-400/30"
        : "text-zinc-400 border-zinc-700";

  return (
    <span
      className={`${color} border font-mono text-xs px-1.5 py-0.5 uppercase`}
    >
      {priority}
    </span>
  );
}
