import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";

export const clusterSellers = createTool({
  description:
    "Analyze seller data across findings and identify likely related seller accounts",
  inputSchema: z.object({
    investigationId: z
      .string()
      .describe("The investigation to cluster sellers for"),
  }),
  execute: async (_ctx, _input) => {
    // TODO: implement seller clustering via GPT-5.4-mini
    return "TODO: implement clusterSellers";
  },
});
