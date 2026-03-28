"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ExternalLink, Maximize2, X } from "lucide-react";

interface TinyFishMonitorProps {
  investigationId: Id<"investigations">;
}

interface ExpandedPreviewState {
  marketplace: string;
  streamingUrl: string;
}

const CAPTCHA_STATUS_PATTERN =
  /captcha|access denied|cloudflare|checking your browser|security check|data\s*dome/i;

export default function TinyFishMonitor({
  investigationId,
}: TinyFishMonitorProps) {
  const [expandedPreview, setExpandedPreview] =
    useState<ExpandedPreviewState | null>(null);
  const agents = useQuery(api.functions.monitor.listByInvestigation, {
    investigationId,
  });

  if (agents === undefined) {
    return (
      <div className="flex items-center justify-center w-full">
        <p className="text-zinc-600 font-mono text-xs">
          Connecting to TinyFish monitor...
        </p>
      </div>
    );
  }

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
            {agent.streamingUrl ? (
              <button
                type="button"
                className="w-full h-full relative group"
                onClick={() =>
                  setExpandedPreview({
                    marketplace: agent.marketplace,
                    streamingUrl: agent.streamingUrl!,
                  })
                }
              >
                <iframe
                  src={agent.streamingUrl}
                  title={`Live browser preview for ${agent.marketplace}`}
                  className="w-full h-full border-0 pointer-events-none"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[10px] font-mono text-zinc-200 opacity-85 group-hover:opacity-100 transition-opacity">
                  EXPAND
                  <Maximize2 className="w-3 h-3" />
                </span>
              </button>
            ) : agent.screenshotUrl ? (
              // TinyFish screenshot URLs are external and ephemeral, so we render them directly.
              // eslint-disable-next-line @next/next/no-img-element
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
            {agent.streamingUrl ? (
              <a
                href={agent.streamingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-amber-400 hover:text-amber-300"
              >
                OPEN LIVE STREAM
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : null}
            {CAPTCHA_STATUS_PATTERN.test(agent.statusLabel) ? (
              <p className="mt-1 text-[10px] font-mono text-amber-400">
                CAPTCHA/anti-bot challenge detected.
              </p>
            ) : null}
          </div>
        </div>
      ))}
      {expandedPreview ? (
        <LiveBrowserModal
          marketplace={expandedPreview.marketplace}
          streamingUrl={expandedPreview.streamingUrl}
          onClose={() => setExpandedPreview(null)}
        />
      ) : null}
    </>
  );
}

function LiveBrowserModal({
  marketplace,
  streamingUrl,
  onClose,
}: {
  marketplace: string;
  streamingUrl: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-4 md:p-8">
      <div className="h-full w-full bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
        <div className="h-11 shrink-0 px-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="text-zinc-200 font-mono text-xs uppercase tracking-wide truncate">
            Live Agent Browser · {marketplace}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={streamingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400 hover:text-amber-300"
            >
              OPEN IN NEW TAB
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
              aria-label="Close live browser preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <iframe
          src={streamingUrl}
          title={`Expanded live browser preview for ${marketplace}`}
          className="w-full flex-1 border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
    </div>
  );
}
