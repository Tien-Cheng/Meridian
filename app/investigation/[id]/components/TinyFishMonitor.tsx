"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ExternalLink, Maximize2, X } from "lucide-react";

interface TinyFishMonitorProps {
  investigationId: Id<"investigations">;
  regions: Array<{
    name: string;
    marketplace: string;
  }>;
}

interface ExpandedPreviewState {
  marketplace: string;
  streamingUrl: string;
}

type MonitorAgent = {
  _id: string;
  agentIndex: number;
  region: string;
  marketplace: string;
  status:
    | "idle"
    | "launching"
    | "searching"
    | "inspecting"
    | "verifying_credentials"
    | "checking_shipping"
    | "crawling_storefront"
    | "completed"
    | "error";
  statusLabel: string;
  tinyfishRunId?: string | null;
  screenshotUrl: string | null;
  streamingUrl: string | null;
  currentUrl?: string | null;
  updatedAt: number;
};

const CAPTCHA_STATUS_PATTERN =
  /captcha|access denied|cloudflare|checking your browser|security check|data\s*dome/i;

function normalizeStreamingUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function TinyFishMonitor({
  investigationId,
  regions,
}: TinyFishMonitorProps) {
  const [expandedPreview, setExpandedPreview] =
    useState<ExpandedPreviewState | null>(null);
  const [liveAgents, setLiveAgents] = useState<MonitorAgent[] | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const queryAgents = useQuery(api.functions.monitor.listByInvestigation, {
    investigationId,
  });

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/investigation/${investigationId}/monitor-stream`
    );

    const onConnected = () => {
      setSseConnected(true);
    };

    const onSnapshot = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as {
          agents?: MonitorAgent[];
        };
        if (Array.isArray(parsed.agents)) {
          setLiveAgents(parsed.agents);
          setSseConnected(true);
        }
      } catch {
        // Ignore malformed events.
      }
    };

    const onStreamError = () => {
      setSseConnected(false);
    };
    const onEnd = () => {
      setSseConnected(false);
    };

    eventSource.addEventListener("connected", onConnected);
    eventSource.addEventListener("snapshot", onSnapshot as EventListener);
    eventSource.addEventListener("stream_error", onStreamError);
    eventSource.addEventListener("end", onEnd);
    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [investigationId]);

  const seededAgents: MonitorAgent[] = regions.map((region, agentIndex) => ({
    _id: `seed-${agentIndex}`,
    agentIndex,
    region: region.name,
    marketplace: region.marketplace,
    status: "launching",
    statusLabel: "Queued. Waiting for TinyFish run...",
    screenshotUrl: null,
    streamingUrl: null,
    currentUrl: null,
    updatedAt: 0,
  }));

  const queryAgentList = queryAgents as MonitorAgent[] | undefined;
  const agents =
    liveAgents ??
    (queryAgentList && queryAgentList.length > 0
      ? queryAgentList
      : seededAgents.length > 0
        ? seededAgents
        : queryAgentList);

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
          {sseConnected
            ? "TinyFish agents will appear here after you send investigation details in Chat."
            : "Waiting for TinyFish monitor stream..."}
        </p>
      </div>
    );
  }

  return (
    <>
      {agents.map((agent) => (
        <AgentMonitorCard
          key={agent._id}
          agent={agent}
          onExpand={(streamingUrl) =>
            setExpandedPreview({
              marketplace: agent.marketplace,
              streamingUrl,
            })
          }
        />
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

function AgentMonitorCard({
  agent,
  onExpand,
}: {
  agent: MonitorAgent;
  onExpand: (streamingUrl: string) => void;
}) {
  const liveStreamingUrl = normalizeStreamingUrl(agent.streamingUrl);
  const [loadedStreamUrl, setLoadedStreamUrl] = useState<string | null>(null);
  const [failedStreamUrl, setFailedStreamUrl] = useState<string | null>(null);
  const streamError = Boolean(
    liveStreamingUrl && failedStreamUrl === liveStreamingUrl
  );
  const isLoading = Boolean(liveStreamingUrl && loadedStreamUrl !== liveStreamingUrl);

  return (
    <div
      className={`flex-shrink-0 w-[240px] bg-zinc-900 border border-zinc-800 flex flex-col ${
        agent.status === "completed"
          ? "border-l-2 border-l-emerald-500"
          : agent.status === "error"
            ? "border-l-2 border-l-red-500"
            : "border-l-2 border-l-amber-500"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-zinc-300 font-mono text-xs font-bold uppercase truncate">
          {agent.marketplace}
        </span>
        {(agent.tinyfishRunId || liveStreamingUrl || agent.screenshotUrl) &&
          agent.status !== "completed" &&
          agent.status !== "error" && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-red-500 animate-pulse" />
              <span className="text-red-500 font-mono text-xs font-bold">
                LIVE
              </span>
            </span>
          )}
      </div>

      <div className="flex-1 bg-zinc-950 flex items-center justify-center">
        {liveStreamingUrl ? (
          <button
            type="button"
            className="w-full h-full relative group"
            onClick={() => onExpand(liveStreamingUrl)}
          >
            {isLoading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/85">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              </div>
            ) : null}
            <iframe
              key={liveStreamingUrl}
              src={liveStreamingUrl}
              title={`Live browser preview for ${agent.marketplace}`}
              className="w-full h-full border-0 pointer-events-none"
              onLoad={() => setLoadedStreamUrl(liveStreamingUrl)}
              onError={() => setFailedStreamUrl(liveStreamingUrl)}
              sandbox="allow-scripts allow-same-origin"
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

      <div className="px-3 py-2 border-t border-zinc-800">
        <p className="text-zinc-500 font-mono text-xs truncate">
          {agent.statusLabel}
        </p>
        {liveStreamingUrl ? (
          <a
            href={liveStreamingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-amber-400 hover:text-amber-300"
          >
            OPEN LIVE STREAM
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
        {streamError ? (
          <p className="mt-1 text-[10px] font-mono text-red-400">
            Live iframe failed to render. Open stream in a new tab.
          </p>
        ) : null}
        {CAPTCHA_STATUS_PATTERN.test(agent.statusLabel) ? (
          <p className="mt-1 text-[10px] font-mono text-amber-400">
            CAPTCHA/anti-bot challenge detected. TinyFish cannot auto-solve it.
          </p>
        ) : null}
      </div>
    </div>
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
  const normalizedStreamingUrl = normalizeStreamingUrl(streamingUrl);
  const [loadedStreamUrl, setLoadedStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const isLoading =
    Boolean(normalizedStreamingUrl) && loadedStreamUrl !== normalizedStreamingUrl;

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
              href={normalizedStreamingUrl ?? streamingUrl}
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
        <div className="relative w-full flex-1">
          {isLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/85">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            </div>
          ) : null}
          {streamError ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/95 px-6 text-center">
              <p className="text-xs font-mono text-red-400">
                Unable to render live browser in iframe. Use OPEN IN NEW TAB.
              </p>
            </div>
          ) : null}
          {normalizedStreamingUrl ? (
            <iframe
              key={normalizedStreamingUrl}
              src={normalizedStreamingUrl}
              title={`Expanded live browser preview for ${marketplace}`}
              className="w-full h-full border-0"
              onLoad={() => setLoadedStreamUrl(normalizedStreamingUrl)}
              onError={() => setStreamError(true)}
              sandbox="allow-scripts allow-same-origin"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
