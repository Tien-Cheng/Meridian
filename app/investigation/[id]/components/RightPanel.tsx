"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import ChatPanel from "./ChatPanel";
import EvidencePanel from "./EvidencePanel";
import CasePanel from "./CasePanel";

type Tab = "chat" | "evidence" | "case";

interface RightPanelProps {
  investigationId: Id<"investigations">;
  investigationContext: {
    drugName?: string;
    protectedMarket?: string;
    regions?: Array<{
      marketplace: string;
      name: string;
    }>;
    sku?: string;
  };
  selectedFindingId: Id<"findings"> | null;
  threadId: string;
  investigationStatus: string;
}

export default function RightPanel({
  investigationId,
  investigationContext,
  selectedFindingId,
  threadId,
  investigationStatus,
}: RightPanelProps) {
  const [preCompletionTab, setPreCompletionTab] = useState<Tab>("chat");
  const [postCompletionTab, setPostCompletionTab] = useState<Tab | null>(null);
  const findings =
    useQuery(api.functions.findings.listByInvestigation, {
      investigationId,
    }) ?? [];
  const caseFile = useQuery(api.functions.cases.getByInvestigation, {
    investigationId,
  });
  const evidenceCount = findings.length;
  const caseReady = Boolean(caseFile);
  const isCompleted = investigationStatus === "completed";
  const activeTab = isCompleted ? (postCompletionTab ?? "case") : preCompletionTab;

  const tabMeta = useMemo(
    () => [
      { id: "chat" as const, label: "CHAT" },
      { id: "evidence" as const, label: `EVIDENCE (${evidenceCount})` },
      { id: "case" as const, label: "CASE", ready: caseReady },
    ],
    [caseReady, evidenceCount]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 shrink-0">
        {tabMeta.map((tab) => (
          <button
            key={tab.id}
            className={`flex-1 py-2.5 font-mono text-xs tracking-wider uppercase transition-colors cursor-pointer ${
              activeTab === tab.id
                ? "text-amber-500 border-b border-amber-500"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => {
              if (isCompleted) {
                setPostCompletionTab(tab.id);
              } else {
                setPreCompletionTab(tab.id);
              }
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span>{tab.label}</span>
              {"ready" in tab && tab.ready ? (
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              ) : null}
            </span>
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 relative">
        {activeTab === "chat" && (
          <div className="absolute inset-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
            <ChatPanel
              investigationContext={investigationContext}
              investigationStatus={investigationStatus}
              investigationId={investigationId}
              threadId={threadId}
            />
          </div>
        )}
        {activeTab === "evidence" && (
          <div className="absolute inset-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
            <EvidencePanel
              investigationId={investigationId}
              selectedFindingId={selectedFindingId}
            />
          </div>
        )}
        {activeTab === "case" && (
          <div className="absolute inset-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
            <CasePanel investigationId={investigationId} />
          </div>
        )}
      </div>
    </div>
  );
}
