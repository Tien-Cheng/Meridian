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
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, { threadId, promptMessageId }) => {
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
