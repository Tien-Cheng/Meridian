import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { FunctionReference } from "convex/server";
import { TINYFISH_API_URL } from "./constants";

export type TinyFishBrowserProfile = "lite" | "stealth";

interface TinyFishRequest {
  url: string;
  goal: string;
  browser_profile?: TinyFishBrowserProfile;
  proxy_config?: { enabled: boolean; country_code?: string };
}

type StreamContext = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

interface StreamMeta {
  investigationId: string;
  agentIndex: number;
  region: string;
}

type UpdateAgentFn = FunctionReference<"mutation", "public" | "internal">;

const CAPTCHA_SIGNAL_PATTERN =
  /captcha|cloudflare|data\s*dome|checking your browser|access denied|security check/i;
const TINYFISH_RUNS_API_BASE = "https://agent.tinyfish.ai/v1/runs";
const RUN_POLL_INTERVAL_MS = 6_000;

interface TinyFishRunState {
  status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  streamingUrl?: string;
  result?: unknown;
  errorMessage?: string;
}

interface NormalizedTinyFishEvent {
  eventType?: string;
  runId?: string;
  status?: string;
  statusLabel?: string;
  streamingUrl?: string;
  screenshotUrl?: string;
  currentUrl?: string;
  result?: unknown;
  errorMessage?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function findFirstByKey(
  input: unknown,
  keys: ReadonlySet<string>,
  depth = 0
): unknown {
  if (depth > 5) {
    return undefined;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findFirstByKey(item, keys, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(input)) {
    return undefined;
  }

  for (const [key, value] of Object.entries(input)) {
    if (keys.has(key) && value !== undefined && value !== null) {
      return value;
    }
  }

  for (const value of Object.values(input)) {
    const found = findFirstByKey(value, keys, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function findFirstStringByKey(
  input: unknown,
  keys: ReadonlySet<string>
): string | undefined {
  const value = findFirstByKey(input, keys);
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
}

function findFirstObjectByKey(
  input: unknown,
  keys: ReadonlySet<string>
): Record<string, unknown> | undefined {
  const value = findFirstByKey(input, keys);
  return isRecord(value) ? value : undefined;
}

function formatProgressLabel(rawLabel: string): string {
  if (CAPTCHA_SIGNAL_PATTERN.test(rawLabel)) {
    return "Anti-bot challenge detected. Waiting for auto-resolution...";
  }
  return rawLabel;
}

function normalizeEventPayload(
  payload: unknown,
  sseEventTypeHint?: string
): NormalizedTinyFishEvent {
  const type =
    pickString(
      sseEventTypeHint,
      findFirstStringByKey(payload, new Set(["type", "event", "event_type"]))
    )?.toUpperCase() ?? undefined;

  const runId = findFirstStringByKey(payload, new Set(["runId", "run_id"]));
  const status = findFirstStringByKey(payload, new Set(["status", "state"]));
  const statusLabel = pickString(
    findFirstStringByKey(payload, new Set(["step_description", "stepDescription"])),
    findFirstStringByKey(payload, new Set(["purpose", "message", "detail"]))
  );

  const streamingUrl = findFirstStringByKey(payload, new Set(["streamingUrl", "streaming_url"]));
  const screenshotUrl = findFirstStringByKey(payload, new Set(["screenshotUrl", "screenshot_url"]));
  const currentUrl = findFirstStringByKey(payload, new Set(["currentUrl", "current_url", "url"]));

  const nestedError = findFirstObjectByKey(payload, new Set(["error"]));
  const errorMessage = pickString(
    nestedError?.message,
    nestedError?.error,
    findFirstStringByKey(payload, new Set(["error", "help_message", "message"]))
  );

  const result =
    findFirstByKey(payload, new Set(["resultJson", "result_json", "result"])) ??
    undefined;

  return {
    eventType: type,
    runId,
    status,
    statusLabel,
    streamingUrl,
    screenshotUrl,
    currentUrl,
    result,
    errorMessage,
  };
}

async function fetchRunState(
  runId: string,
  timeoutMs = 8_000
): Promise<TinyFishRunState | undefined> {
  const response = await fetch(`${TINYFISH_RUNS_API_BASE}/${runId}`, {
    method: "GET",
    headers: {
      "X-API-Key": process.env.TINYFISH_API_KEY!,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    return undefined;
  }

  const run = isRecord(payload.run) ? payload.run : payload;
  const statusRaw = pickString(run.status, payload.status)?.toUpperCase();
  const status =
    statusRaw === "PENDING" ||
    statusRaw === "RUNNING" ||
    statusRaw === "COMPLETED" ||
    statusRaw === "FAILED" ||
    statusRaw === "CANCELLED"
      ? statusRaw
      : undefined;

  const errorObject = isRecord(run.error) ? run.error : isRecord(payload.error) ? payload.error : undefined;

  return {
    status,
    streamingUrl: pickString(run.streaming_url, run.streamingUrl, payload.streaming_url, payload.streamingUrl),
    result: run.result ?? payload.result,
    errorMessage: pickString(
      errorObject?.message,
      errorObject?.error,
      run.error,
      payload.error
    ),
  };
}

/**
 * Call the TinyFish SSE endpoint and process the event stream.
 * Updates the agent monitor on each STEP, COMPLETE, and ERROR event.
 */
export async function callTinyFish(request: TinyFishRequest): Promise<Response> {
  return callTinyFishWithOptions(request);
}

export async function callTinyFishWithOptions(
  request: TinyFishRequest,
  options?: { signal?: AbortSignal }
): Promise<Response> {
  return fetch(TINYFISH_API_URL, {
    method: "POST",
    headers: {
      "X-API-Key": process.env.TINYFISH_API_KEY!,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify(request),
    signal: options?.signal,
  });
}

/**
 * Process a TinyFish SSE response stream, updating the agent monitor
 * in real time and returning the final result on completion.
 */
export async function processTinyFishStream(
  response: Response,
  ctx?: StreamContext,
  meta?: StreamMeta,
  updateAgentFn?: UpdateAgentFn,
  options?: { readTimeoutMs?: number; maxDurationMs?: number }
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("TinyFish response did not include a stream body.");
  }

  const readTimeoutMs = options?.readTimeoutMs ?? 45_000;
  const maxDurationMs = options?.maxDurationMs ?? 240_000;
  const decoder = new TextDecoder();
  let buffer = "";
  let result: unknown = null;
  const startedAt = Date.now();
  let activeRunId: string | undefined;
  let activeStreamingUrl: string | undefined;
  let lastRunLookupAt = 0;
  let latestStatusLabel = "TinyFish run started";
  let sawTerminalEvent = false;

  const updateMonitor = async (
    status:
      | "idle"
      | "launching"
      | "searching"
      | "inspecting"
      | "completed"
      | "error"
      | "crawling_storefront",
    statusLabel: string,
    extras?: { screenshotUrl?: string; streamingUrl?: string; currentUrl?: string }
  ) => {
    if (!ctx || !meta || !updateAgentFn) {
      return;
    }

    await ctx.runMutation(updateAgentFn, {
      investigationId: meta.investigationId,
      agentIndex: meta.agentIndex,
      status,
      statusLabel,
      screenshotUrl: extras?.screenshotUrl,
      streamingUrl: extras?.streamingUrl,
      currentUrl: extras?.currentUrl,
    });
  };

  const syncRunState = async (force = false): Promise<"continue" | "completed"> => {
    if (!activeRunId) {
      return "continue";
    }

    const now = Date.now();
    if (!force && now - lastRunLookupAt < RUN_POLL_INTERVAL_MS) {
      return "continue";
    }
    lastRunLookupAt = now;

    let runState: TinyFishRunState | undefined;
    try {
      runState = await fetchRunState(activeRunId);
    } catch {
      return "continue";
    }

    if (!runState) {
      return "continue";
    }

    if (runState.streamingUrl && runState.streamingUrl !== activeStreamingUrl) {
      activeStreamingUrl = runState.streamingUrl;
      await updateMonitor("searching", "Live browser stream available", {
        streamingUrl: runState.streamingUrl,
        currentUrl: runState.streamingUrl,
      });
    }

    if (runState.status === "PENDING") {
      latestStatusLabel = "Waiting for TinyFish browser slot...";
      await updateMonitor("searching", latestStatusLabel, {
        streamingUrl: activeStreamingUrl,
        currentUrl: activeStreamingUrl,
      });
      return "continue";
    }

    if (runState.status === "RUNNING") {
      latestStatusLabel = activeStreamingUrl
        ? "TinyFish run in progress"
        : "TinyFish run started";
      await updateMonitor("searching", latestStatusLabel, {
        streamingUrl: activeStreamingUrl,
        currentUrl: activeStreamingUrl,
      });
      return "continue";
    }

    if (runState.status === "COMPLETED") {
      if (result === null && runState.result !== undefined) {
        result = runState.result;
      }
      sawTerminalEvent = true;
      await updateMonitor("completed", "Done", {
        currentUrl: activeStreamingUrl,
      });
      return "completed";
    }

    if (runState.status === "FAILED" || runState.status === "CANCELLED") {
      const errorMessage =
        runState.errorMessage ?? `TinyFish run ${runState.status.toLowerCase()}`;
      await updateMonitor("error", errorMessage);
      throw new Error(errorMessage);
    }

    return "continue";
  };

  const readChunkWithTimeout = async (): Promise<
    ReadableStreamReadResult<Uint8Array>
  > => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new Error(
                `TinyFish stream produced no SSE events for ${Math.round(
                  readTimeoutMs / 1000
                )}s`
              )
            );
          }, readTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  const handleRawEvent = async (rawEvent: string) => {
    const normalizedEvent = rawEvent.replace(/\r\n/g, "\n").trim();
    if (!normalizedEvent) {
      return;
    }

    let sseEventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of normalizedEvent.split("\n")) {
      if (line.startsWith("event:")) {
        sseEventType = line.slice(6).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    if (dataLines.length === 1 && dataLines[0] === "[DONE]") {
      return;
    }

    const rawData = dataLines.join("\n");
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawData);
    } catch {
      parsedPayload = { message: rawData };
    }

    const event = normalizeEventPayload(parsedPayload, sseEventType);
    const eventType = event.eventType;

    if (event.runId) {
      activeRunId = event.runId;
    }

    if (eventType === "HEARTBEAT") {
      await syncRunState();
      return;
    }

    if (eventType === "STARTED") {
      latestStatusLabel = "TinyFish run started";
      await updateMonitor("searching", latestStatusLabel, {
        streamingUrl: activeStreamingUrl,
        currentUrl: activeStreamingUrl,
      });
      await syncRunState(true);
      return;
    }

    if (eventType === "STREAMING_URL" || event.streamingUrl) {
      activeStreamingUrl = event.streamingUrl ?? activeStreamingUrl;
      if (activeStreamingUrl) {
        latestStatusLabel = "Live browser stream available";
        await updateMonitor("searching", latestStatusLabel, {
          streamingUrl: activeStreamingUrl,
          currentUrl: activeStreamingUrl,
        });
      }
      if (eventType === "STREAMING_URL") {
        return;
      }
    }

    if (eventType === "STEP" || eventType === "PROGRESS" || eventType === "STATUS") {
      latestStatusLabel = formatProgressLabel(event.statusLabel ?? "Working...");
      await updateMonitor("searching", latestStatusLabel, {
        screenshotUrl: event.screenshotUrl,
        streamingUrl: activeStreamingUrl,
        currentUrl: event.currentUrl ?? activeStreamingUrl,
      });
      await syncRunState();
      return;
    }

    if (eventType === "COMPLETE" || event.status?.toUpperCase() === "COMPLETED") {
      sawTerminalEvent = true;
      if (event.result !== undefined) {
        result = event.result;
      }
      await updateMonitor("completed", "Done", {
        currentUrl: event.currentUrl ?? activeStreamingUrl,
      });
      return;
    }

    if (
      eventType === "ERROR" ||
      event.status?.toUpperCase() === "FAILED" ||
      event.status?.toUpperCase() === "CANCELLED"
    ) {
      const errorMessage = event.errorMessage ?? "Error occurred";
      await updateMonitor("error", errorMessage);
      throw new Error(errorMessage);
    }

    if (event.statusLabel) {
      latestStatusLabel = formatProgressLabel(event.statusLabel);
      await updateMonitor("searching", latestStatusLabel, {
        screenshotUrl: event.screenshotUrl,
        streamingUrl: activeStreamingUrl,
        currentUrl: event.currentUrl ?? activeStreamingUrl,
      });
      await syncRunState();
    }
  };

  while (!sawTerminalEvent) {
    if (Date.now() - startedAt > maxDurationMs) {
      throw new Error(
        `TinyFish stream exceeded ${Math.round(maxDurationMs / 1000)}s time limit`
      );
    }

    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await readChunkWithTimeout();
    } catch (error) {
      const recovered = await syncRunState(true);
      if (recovered === "completed") {
        break;
      }
      throw error;
    }

    const { done, value } = chunk;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      await handleRawEvent(rawEvent);
      if (sawTerminalEvent) {
        break;
      }
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      if (buffer.trim() && !sawTerminalEvent) {
        await handleRawEvent(buffer);
      }

      if (!sawTerminalEvent) {
        const recovered = await syncRunState(true);
        if (recovered !== "completed") {
          throw new Error(
            activeRunId
              ? `TinyFish stream ended before completion (run ${activeRunId}). Last status: ${latestStatusLabel}`
              : "TinyFish stream ended before completion."
          );
        }
      }

      break;
    }
  }

  return result;
}
