import { TINYFISH_API_URL } from "./constants";

interface TinyFishRequest {
  url: string;
  goal: string;
  proxy_config?: { enabled: boolean };
}

interface StreamContext {
  runMutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
}

interface StreamMeta {
  investigationId: string;
  agentIndex: number;
  region: string;
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
  ctx: StreamContext,
  meta: StreamMeta,
  updateAgentFn: unknown
): Promise<unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result: unknown = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

    for (const line of lines) {
      const data = JSON.parse(line.slice(6));

      if (data.type === "STEP") {
        await ctx.runMutation(updateAgentFn, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "searching",
          statusLabel: data.step_description || "Working...",
          screenshotUrl: data.screenshot_url || undefined,
          currentUrl: data.current_url || undefined,
        });
      }

      if (data.type === "STREAMING_URL") {
        await ctx.runMutation(updateAgentFn, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "searching",
          statusLabel: "Live browser active",
          currentUrl: data.streaming_url || undefined,
        });
      }

      if (data.type === "COMPLETE") {
        result = data.result;
        await ctx.runMutation(updateAgentFn, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "completed",
          statusLabel: "Done",
        });
      }

      if (data.type === "ERROR") {
        await ctx.runMutation(updateAgentFn, {
          investigationId: meta.investigationId,
          agentIndex: meta.agentIndex,
          status: "error",
          statusLabel: data.error || "Error occurred",
        });
        throw new Error(data.error);
      }
    }
  }

  return result;
}
