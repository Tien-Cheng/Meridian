"use client";

import { useState } from "react";
import { Id } from "@/convex/_generated/dataModel";
import ChatPanel from "./ChatPanel";
import EvidencePanel from "./EvidencePanel";
import CasePanel from "./CasePanel";

type Tab = "chat" | "evidence" | "case";

interface RightPanelProps {
  investigationId: Id<"investigations">;
  threadId: string;
  investigationStatus: string;
}

export default function RightPanel({
  investigationId,
  threadId,
  investigationStatus,
}: RightPanelProps) {
  const [selectedTab, setSelectedTab] = useState<Tab>("chat");
  const activeTab: Tab =
    investigationStatus === "completed" ? "case" : selectedTab;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 shrink-0">
        {(["chat", "evidence", "case"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`flex-1 py-2.5 font-mono text-xs tracking-wider uppercase transition-colors cursor-pointer ${
              activeTab === tab
                ? "text-amber-500 border-b border-amber-500"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setSelectedTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0">
        {activeTab === "chat" && (
          <ChatPanel
            investigationId={investigationId}
            threadId={threadId}
          />
        )}
        {activeTab === "evidence" && (
          <EvidencePanel investigationId={investigationId} />
        )}
        {activeTab === "case" && (
          <CasePanel investigationId={investigationId} />
        )}
      </div>
    </div>
  );
}
