import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";

export const verifyShipping = createTool({
  description:
    "Verify whether a marketplace listing can actually ship to the protected market by testing the cart/checkout flow",
  inputSchema: z.object({
    listingUrl: z
      .string()
      .describe("The URL of the listing to verify"),
    protectedMarket: z
      .string()
      .describe("The country to check shipping to, e.g. France"),
    findingId: z
      .string()
      .describe("The ID of the finding to update with verification results"),
  }),
  execute: async (_ctx, _input) => {
    // TODO: implement TinyFish cart/shipping verification
    return "TODO: implement verifyShipping";
  },
});
