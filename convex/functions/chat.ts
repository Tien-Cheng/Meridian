import { query, mutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod/v4";
import {
  createThread,
  saveMessage,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { components, internal } from "../_generated/api";
import { investigatorAgent } from "../agents/investigator";
import { InvestigationRequestSchema } from "../../shared/schemas";

const LaunchDecisionSchema = z.object({
  canLaunch: z.boolean(),
  clarificationQuestion: z.string().optional(),
  protectedMarket: z.string().optional(),
  request: InvestigationRequestSchema.optional(),
});

async function addAssistantMessage(
  ctx: Parameters<typeof investigatorAgent.streamText>[0],
  threadId: string,
  content: string
) {
  await ctx.runMutation(components.agent.messages.addMessages, {
    agentName: "Meridian Investigator",
    messages: [
      {
        message: {
          role: "assistant",
          content,
        },
      },
    ],
    threadId,
  });
}

async function parseLaunchPrompt(prompt: string) {
  const { object } = await generateObject({
    model: openai.chat("gpt-5.4-mini"),
    schema: LaunchDecisionSchema,
    prompt: [
      "You decide whether a user message contains enough information to launch a structured pharmaceutical marketplace investigation.",
      "Do not invent missing details. If the prompt is missing the drug, target marketplaces/regions, or the regulatory purpose, set canLaunch=false and ask one concise clarification question.",
      "If the prompt contains enough detail, set canLaunch=true and fill request plus protectedMarket.",
      "protectedMarket should be the market most clearly being protected from cross-border sales. If unclear but the request is otherwise launchable, use the first region name.",
      "",
      `User message: ${prompt}`,
    ].join("\n"),
    abortSignal: AbortSignal.timeout(30_000),
  });

  return LaunchDecisionSchema.parse(object);
}

export const createNewThread = mutation({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent);
    return threadId;
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    investigationId: v.optional(v.id("investigations")),
  },
  handler: async (ctx, { threadId, prompt, investigationId }) => {
    // If the chat message is tied to an investigation, schedule workflow kickoff.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });

    if (investigationId) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.investigations.maybeKickoffFromPrompt,
        { investigationId, prompt }
      );
    }

    await ctx.scheduler.runAfter(0, internal.functions.chat.generateResponse, {
      threadId,
      prompt,
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { threadId, prompt, promptMessageId }) => {
    const investigation = await ctx.runQuery(
      internal.functions.investigations.getByThread,
      { threadId }
    );

    if (!investigation) {
      await investigatorAgent.streamText(
        ctx,
        { threadId },
        { promptMessageId },
        { saveStreamDeltas: true }
      );
      return;
    }

    if (investigation.status === "pending") {
      const launchDecision = await parseLaunchPrompt(prompt);

      if (!launchDecision.canLaunch || !launchDecision.request) {
        await addAssistantMessage(
          ctx,
          threadId,
          launchDecision.clarificationQuestion ??
            "Please tell me the drug name, which marketplaces/regions to scan, and the target market you want protected so I can launch the investigation."
        );
        return;
      }

      const protectedMarket =
        launchDecision.protectedMarket?.trim() ||
        launchDecision.request.regions[0]?.name ||
        "target market";

      const prepared = await ctx.runMutation(
        internal.functions.investigations.prepareLaunch,
        {
          threadId,
          drugName: launchDecision.request.drugName,
          drugCategory: launchDecision.request.drugCategory,
          regions: launchDecision.request.regions,
          regulatoryContext: launchDecision.request.regulatoryContext,
          protectedMarket,
        }
      );

      if (prepared.status === "missing") {
        await addAssistantMessage(
          ctx,
          threadId,
          "I couldn't locate an investigation record for this thread, so I wasn't able to launch the workflow."
        );
        return;
      }

      if (prepared.status === "already_started") {
        await addAssistantMessage(
          ctx,
          threadId,
          "This investigation is already launching or in progress. I’ll keep the chat focused on narration and evidence review from here."
        );
        return;
      }

      try {
        await ctx.runMutation(internal.functions.investigations.launchWorkflow, {
          investigationId: prepared.investigationId,
          threadId: prepared.threadId,
          drugName: launchDecision.request.drugName,
          drugCategory: launchDecision.request.drugCategory,
          regions: launchDecision.request.regions,
          regulatoryContext: launchDecision.request.regulatoryContext,
        });

        await addAssistantMessage(
          ctx,
          threadId,
          `Launching investigation for ${launchDecision.request.drugName} across ${launchDecision.request.regions.length} marketplace${launchDecision.request.regions.length === 1 ? "" : "s"}. The map, evidence panel, and TinyFish monitor will update as findings arrive.`
        );
      } catch (error) {
        await ctx.runMutation(internal.functions.investigations.updateStatus, {
          id: prepared.investigationId,
          status: "pending",
        });
        await addAssistantMessage(
          ctx,
          threadId,
          `I parsed the request, but the investigation workflow failed to start: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
      return;
    }

    if (investigation.status === "configuring") {
      await addAssistantMessage(
        ctx,
        threadId,
        "The investigation launch is already being prepared. I’ll keep the conversation read-only while the workflow initializes."
      );
      return;
    }

    await investigatorAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: true }
    );
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});
