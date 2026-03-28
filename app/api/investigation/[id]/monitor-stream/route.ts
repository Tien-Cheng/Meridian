import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 1200;
const KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_STREAM_WINDOW_MS = 15 * 60 * 1000;
const RUN_LOOKUP_TIMEOUT_MS = 8_000;
const RUN_LOOKUP_MIN_INTERVAL_MS = 3_000;

const ACTIVE_MONITOR_STATUSES = new Set([
  "idle",
  "launching",
  "searching",
  "inspecting",
  "verifying_credentials",
  "checking_shipping",
  "crawling_storefront",
]);
const TERMINAL_MONITOR_STATUSES = new Set(["completed", "error"]);

type TinyFishRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

type TinyFishRunState = {
  status?: TinyFishRunStatus;
  streamingUrl?: string;
  errorMessage?: string;
  notFound?: boolean;
};

type MonitorSnapshot = Awaited<ReturnType<typeof fetchMonitorSnapshot>>;
type MonitorAgent = MonitorSnapshot[number];
type RunLookupCacheEntry = {
  fetchedAt: number;
  state: TinyFishRunState | null;
};

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function fetchMonitorSnapshot(
  client: ConvexHttpClient,
  investigationId: Id<"investigations">
) {
  return await client.query(api.functions.monitor.listByInvestigation, {
    investigationId,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeStreamingUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function extractStreamingUrlFromRecord(
  payload: Record<string, unknown>
): string | undefined {
  return normalizeStreamingUrl(
    payload.streamingUrl ??
      payload.streaming_url ??
      payload.streamUrl ??
      payload.stream_url ??
      payload.liveUrl ??
      payload.live_url
  );
}

function extractStreamingUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return normalizeStreamingUrl(payload);
  }

  const fromRoot = extractStreamingUrlFromRecord(payload);
  if (fromRoot) {
    return fromRoot;
  }

  const nestedData = payload.data;
  if (isRecord(nestedData)) {
    const fromNestedData = extractStreamingUrlFromRecord(nestedData);
    if (fromNestedData) {
      return fromNestedData;
    }
  } else {
    const fromNestedString = normalizeStreamingUrl(nestedData);
    if (fromNestedString) {
      return fromNestedString;
    }
  }

  const run = isRecord(payload.run) ? payload.run : null;
  if (run) {
    return extractStreamingUrlFromRecord(run);
  }

  return undefined;
}

function parseRunStatus(payload: unknown): TinyFishRunStatus | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const run = isRecord(payload.run) ? payload.run : payload;
  const rawStatus = pickString(run.status, payload.status)?.toUpperCase();

  if (
    rawStatus === "PENDING" ||
    rawStatus === "RUNNING" ||
    rawStatus === "COMPLETED" ||
    rawStatus === "FAILED" ||
    rawStatus === "CANCELLED"
  ) {
    return rawStatus;
  }
  return undefined;
}

async function fetchRunState(
  runId: string,
  apiKey: string
): Promise<TinyFishRunState | null> {
  const response = await fetch(`https://agent.tinyfish.ai/v1/runs/${runId}`, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(RUN_LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (response.status === 404) {
      return { notFound: true };
    }
    return null;
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    return null;
  }

  const run = isRecord(payload.run) ? payload.run : payload;
  const error = isRecord(run.error)
    ? run.error
    : isRecord(payload.error)
      ? payload.error
      : undefined;

  return {
    status: parseRunStatus(payload),
    streamingUrl: extractStreamingUrl(payload),
    errorMessage: pickString(
      error?.message,
      error?.error,
      run.error,
      payload.error
    ),
  };
}

async function enrichSnapshot(
  snapshot: MonitorSnapshot,
  apiKey: string | undefined,
  runLookupCache: Map<string, RunLookupCacheEntry>
): Promise<MonitorSnapshot> {
  if (!apiKey) {
    return snapshot;
  }

  return await Promise.all(
    snapshot.map(async (agent): Promise<MonitorAgent> => {
      const runId = agent.tinyfishRunId;
      if (!runId) {
        return agent;
      }

      const isTerminal = TERMINAL_MONITOR_STATUSES.has(agent.status);
      const shouldLookup = !isTerminal || !agent.streamingUrl;
      if (!shouldLookup) {
        return agent;
      }

      const now = Date.now();
      let lookup = runLookupCache.get(runId);
      if (!lookup || now - lookup.fetchedAt >= RUN_LOOKUP_MIN_INTERVAL_MS) {
        const state = await fetchRunState(runId, apiKey).catch(
          () => null as TinyFishRunState | null
        );
        lookup = {
          fetchedAt: now,
          state,
        };
        runLookupCache.set(runId, lookup);
      }

      const state = lookup.state;
      if (!state) {
        return agent;
      }

      if (state.notFound) {
        const next: MonitorAgent = { ...agent };
        if (
          ACTIVE_MONITOR_STATUSES.has(next.status) &&
          !TERMINAL_MONITOR_STATUSES.has(next.status)
        ) {
          next.statusLabel =
            "TinyFish run reference not found. Waiting for retry...";
        }
        return next;
      }

      const next: MonitorAgent = { ...agent };
      const shouldReplaceStream =
        state.streamingUrl &&
        (!next.streamingUrl || state.status === "RUNNING");
      if (shouldReplaceStream) {
        next.streamingUrl = state.streamingUrl ?? next.streamingUrl;
        if (!next.currentUrl) {
          next.currentUrl = state.streamingUrl ?? next.currentUrl;
        }
      }

      if (
        ACTIVE_MONITOR_STATUSES.has(next.status) &&
        !TERMINAL_MONITOR_STATUSES.has(next.status)
      ) {
        if (state.status === "PENDING" && !next.streamingUrl) {
          next.statusLabel = "TinyFish run started. Waiting for browser session...";
        } else if (state.status === "RUNNING" && !next.streamingUrl) {
          next.statusLabel = "TinyFish run is active. Waiting for streaming URL...";
        } else if (state.status === "RUNNING" && next.streamingUrl) {
          next.statusLabel = "Live browser connected.";
        } else if (state.status === "FAILED") {
          next.statusLabel =
            state.errorMessage ??
            "TinyFish run failed (possible anti-bot challenge).";
        } else if (state.status === "CANCELLED") {
          next.statusLabel = "TinyFish run cancelled.";
        }
      }

      return next;
    })
  );
}

function snapshotKey(
  snapshot: MonitorSnapshot
): string {
  return JSON.stringify(
    snapshot
      .slice()
      .sort((a, b) => a.agentIndex - b.agentIndex)
      .map((agent) => ({
        id: agent._id,
        index: agent.agentIndex,
        status: agent.status,
        label: agent.statusLabel,
        updatedAt: agent.updatedAt,
        screenshotUrl: agent.screenshotUrl,
        streamingUrl: agent.streamingUrl,
        tinyfishRunId: agent.tinyfishRunId ?? null,
        currentUrl: agent.currentUrl ?? null,
      }))
  );
}

function toSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const tinyFishApiKey = process.env.TINYFISH_API_KEY;
  if (!convexUrl) {
    return new Response("Missing NEXT_PUBLIC_CONVEX_URL", { status: 500 });
  }

  const client = new ConvexHttpClient(convexUrl);
  const investigationId = id as Id<"investigations">;
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastKey = "";
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      const startedAt = Date.now();
      const runLookupCache = new Map<string, RunLookupCacheEntry>();

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        try {
          controller.close();
        } catch {
          // Ignore close races.
        }
      };

      cleanup = close;

      const sendEvent = (event: string, data: unknown) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(toSseEvent(event, data)));
      };

      const sendComment = (comment: string) => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(toSseComment(comment)));
      };

      const poll = async () => {
        if (closed || request.signal.aborted) {
          close();
          return;
        }

        try {
          const snapshot = await fetchMonitorSnapshot(client, investigationId);
          const enrichedSnapshot = await enrichSnapshot(
            snapshot,
            tinyFishApiKey,
            runLookupCache
          );
          const key = snapshotKey(enrichedSnapshot);
          if (key !== lastKey) {
            lastKey = key;
            sendEvent("snapshot", {
              investigationId,
              at: Date.now(),
              agents: enrichedSnapshot,
            });
          }
        } catch (error) {
          sendEvent("stream_error", {
            message:
              error instanceof Error
                ? error.message
                : "Failed to fetch TinyFish monitor snapshot",
          });
          close();
          return;
        }

        if (Date.now() - startedAt >= MAX_STREAM_WINDOW_MS) {
          sendEvent("end", {
            investigationId,
            reason: "stream_window_elapsed",
          });
          close();
          return;
        }

        pollTimer = setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS);
      };

      request.signal.addEventListener("abort", close, { once: true });
      sendEvent("connected", { investigationId, at: Date.now() });
      void poll();

      keepaliveTimer = setInterval(() => {
        if (closed || request.signal.aborted) {
          close();
          return;
        }
        sendComment(`keepalive ${Date.now()}`);
      }, KEEPALIVE_INTERVAL_MS);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
