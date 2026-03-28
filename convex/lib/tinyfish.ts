import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { TINYFISH_API_URL } from "./constants";

interface TinyFishRequest {
  url: string;
  goal: string;
  browser_profile?: "lite" | "stealth";
  proxy_config?: { enabled: boolean; country_code?: string };
}

type StreamContext = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type ArtifactContext = Pick<GenericActionCtx<GenericDataModel>, "runMutation" | "storage">;

interface StreamMeta {
  investigationId: Id<"investigations">;
  agentIndex: number;
  region: string;
}

type UpdateAgentFn = FunctionReference<"mutation", "public" | "internal">;
type CreateArtifactFn = FunctionReference<"mutation", "internal">;

export type TinyFishSourceTool =
  | "searchMarketplace"
  | "inspectListing"
  | "verifyShipping"
  | "crawlStorefront"
  | "clusterSellers";

export interface TinyFishPersistenceMeta {
  investigationId: Id<"investigations">;
  sourceTool: TinyFishSourceTool;
  createArtifactFn: CreateArtifactFn;
  runId: string;
  findingId?: Id<"findings">;
  clusterId?: string;
  threadId?: string;
  agentIndex?: number;
}

type TinyFishEvent = {
  type?: string;
  result?: unknown;
  error?: string;
  status?: string;
  step_description?: string;
  purpose?: string;
  screenshot_url?: string;
  current_url?: string;
  streaming_url?: string;
};

function safeSerialize(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function persistScreenshot(
  ctx: ArtifactContext,
  screenshotSourceUrl?: string
): Promise<Id<"_storage"> | undefined> {
  if (!screenshotSourceUrl) {
    return undefined;
  }

  try {
    const response = await fetch(screenshotSourceUrl);
    if (!response.ok) {
      return undefined;
    }
    const blob = await response.blob();
    return await ctx.storage.store(blob);
  } catch {
    return undefined;
  }
}

/**
 * Call the TinyFish SSE endpoint and process the event stream.
 * Updates the agent monitor on each STEP, COMPLETE, and ERROR event.
 */
export async function callTinyFish(request: TinyFishRequest): Promise<Response> {
  return fetch(TINYFISH_API_URL, {
    method: "POST",
    headers: {
      "X-API-Key": process.env.TINYFISH_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
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
  artifactCtx?: ArtifactContext,
  artifactMeta?: TinyFishPersistenceMeta
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("TinyFish response did not include a stream body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: unknown = null;
  let stepOrder = 0;

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
    extras?: { screenshotUrl?: string; currentUrl?: string }
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
      currentUrl: extras?.currentUrl,
    });
  };

  const persistArtifact = async ({
    currentUrl,
    data,
    eventType,
    statusLabel,
    streamingUrl,
    summaryText,
  }: {
    currentUrl?: string;
    data: TinyFishEvent;
    eventType: "step" | "progress" | "streaming_url" | "complete" | "error";
    statusLabel: string;
    streamingUrl?: string;
    summaryText?: string;
  }) => {
    if (!artifactCtx || !artifactMeta) {
      return;
    }

    stepOrder += 1;
    const screenshotSourceUrl =
      typeof data.screenshot_url === "string" ? data.screenshot_url : undefined;
    const screenshotStorageId = await persistScreenshot(
      artifactCtx,
      screenshotSourceUrl
    );

    await artifactCtx.runMutation(artifactMeta.createArtifactFn, {
      investigationId: artifactMeta.investigationId,
      findingId: artifactMeta.findingId,
      clusterId: artifactMeta.clusterId,
      threadId: artifactMeta.threadId,
      agentIndex: artifactMeta.agentIndex,
      runId: artifactMeta.runId,
      sourceTool: artifactMeta.sourceTool,
      eventType,
      statusLabel,
      currentUrl,
      streamingUrl,
      screenshotStorageId,
      screenshotSourceUrl,
      summaryText,
      rawEventJson: safeSerialize(data),
      payloadJson:
        eventType === "complete" ? safeSerialize(data.result) : undefined,
      stepOrder,
      capturedAt: Date.now(),
    });
  };

  const handleRawEvent = async (rawEvent: string) => {
    const normalizedEvent = rawEvent.replace(/\r\n/g, "\n").trim();
    if (!normalizedEvent) {
      return;
    }

    const dataLines = normalizedEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return;
    }

    let data: TinyFishEvent;
    try {
      data = JSON.parse(dataLines.join("\n")) as TinyFishEvent;
    } catch {
      return;
    }

    const eventType = data.type;
    if (eventType === "HEARTBEAT") {
      return;
    }

    if (eventType === "STEP" || eventType === "PROGRESS") {
      const statusLabel =
        typeof data.step_description === "string"
          ? data.step_description
          : typeof data.purpose === "string"
            ? data.purpose
            : "Working...";

      await updateMonitor("searching", statusLabel, {
        screenshotUrl:
          typeof data.screenshot_url === "string"
            ? data.screenshot_url
            : undefined,
        currentUrl:
          typeof data.current_url === "string" ? data.current_url : undefined,
      });
      await persistArtifact({
        data,
        eventType: eventType === "STEP" ? "step" : "progress",
        statusLabel,
        currentUrl:
          typeof data.current_url === "string" ? data.current_url : undefined,
        summaryText: statusLabel,
      });
      return;
    }

    if (eventType === "STREAMING_URL") {
      await updateMonitor("searching", "Live browser active", {
        currentUrl:
          typeof data.streaming_url === "string"
            ? data.streaming_url
            : undefined,
      });
      await persistArtifact({
        data,
        eventType: "streaming_url",
        statusLabel: "Live browser active",
        streamingUrl:
          typeof data.streaming_url === "string"
            ? data.streaming_url
            : undefined,
        summaryText: "TinyFish provided a live browser stream URL.",
      });
      return;
    }

    if (eventType === "COMPLETE") {
      result = data.result ?? null;
      await updateMonitor("completed", "Done");
      await persistArtifact({
        data,
        eventType: "complete",
        statusLabel: "Done",
        currentUrl:
          typeof data.current_url === "string" ? data.current_url : undefined,
        summaryText: "TinyFish run completed.",
      });
      return;
    }

    if (eventType === "ERROR") {
      const errorMessage =
        typeof data.error === "string" ? data.error : "Error occurred";
      await updateMonitor("error", errorMessage);
      await persistArtifact({
        data,
        eventType: "error",
        statusLabel: errorMessage,
        currentUrl:
          typeof data.current_url === "string" ? data.current_url : undefined,
        summaryText: errorMessage,
      });
      throw new Error(errorMessage);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundaryIndex = buffer.indexOf("\n\n");
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      await handleRawEvent(rawEvent);
      boundaryIndex = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    await handleRawEvent(buffer);
  }

  return result;
}
