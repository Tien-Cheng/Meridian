import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";

export const crawlStorefront = createTool({
  description:
    "Visit a seller's storefront page and extract all their listings for the target brand",
  inputSchema: z.object({
    sellerStorefrontUrl: z
      .string()
      .describe("The URL of the seller's storefront"),
    brandName: z
      .string()
      .describe("The brand to filter listings for"),
  }),
  execute: async (_ctx, _input) => {
    // TODO: implement TinyFish storefront crawl
    return "TODO: implement crawlStorefront";
  },
});
