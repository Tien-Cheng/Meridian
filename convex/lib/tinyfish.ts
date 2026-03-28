import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { FunctionReference } from "convex/server";
import { TINYFISH_API_URL } from "./constants";

interface TinyFishRequest {
  url: string;
  goal: string;
  browser_profile?: "lite" | "stealth";
  proxy_config?: { enabled: boolean; country_code?: string };
}

type StreamContext = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

interface StreamMeta {
  investigationId: string;
  agentIndex: number;
  region: string;
}

type UpdateAgentFn = FunctionReference<"mutation", "public" | "internal">;

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
  updateAgentFn?: UpdateAgentFn
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("TinyFish response did not include a stream body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: unknown = null;

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
      return;
    }

    if (eventType === "STREAMING_URL") {
      await updateMonitor("searching", "Live browser active", {
        currentUrl:
          typeof data.streaming_url === "string"
            ? data.streaming_url
            : undefined,
      });
      return;
    }

    if (eventType === "COMPLETE") {
      result = data.result ?? null;
      await updateMonitor("completed", "Done");
      return;
    }

    if (eventType === "ERROR") {
      const errorMessage =
        typeof data.error === "string" ? data.error : "Error occurred";
      await updateMonitor("error", errorMessage);
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
