import { query, mutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
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

const INVESTIGATOR_AGENT_NAME = "Meridian Investigator";

export const createNewThread = mutation({
  args: {},
  handler: async (ctx) => {
    const threadId = await createThread(ctx, components.agent);
    return threadId;
  },
});

export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  handler: async (ctx, { threadId, prompt }) => {
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    });
    await ctx.scheduler.runAfter(0, internal.functions.chat.generateResponse, {
      threadId,
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, { threadId, promptMessageId }) => {
    const parseResult = await ctx.runAction(
      internal.functions.investigations.parsePendingInvestigationPrompt,
      { threadId }
    );

    if (parseResult.status === "clarification_needed") {
      await saveMessage(ctx, components.agent, {
        threadId,
        promptMessageId,
        agentName: INVESTIGATOR_AGENT_NAME,
        message: {
          role: "assistant",
          content: parseResult.question,
        },
      });
      return;
    }

    await investigatorAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: true },
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
