import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";

export const generateCaseFile = createTool({
  description:
    "Synthesize all investigation evidence into a structured enforcement-ready case file",
  inputSchema: z.object({
    investigationId: z
      .string()
      .describe("The investigation to generate a case for"),
    protectedMarket: z
      .string()
      .describe("The protected market, e.g. France"),
  }),
  execute: async (_ctx, _input) => {
    // TODO: implement case generation via GPT-5.4
    return "TODO: implement generateCaseFile";
  },
});
