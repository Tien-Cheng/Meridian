import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";

export const searchMarketplace = createTool({
  description:
    "Search a marketplace for a product and extract all listings with prices and seller info",
  inputSchema: z.object({
    marketplaceUrl: z
      .string()
      .describe("The marketplace URL to search, e.g. https://www.amazon.de"),
    searchQuery: z
      .string()
      .describe("The product name or SKU to search for"),
    region: z
      .string()
      .describe("The marketplace region, e.g. Germany"),
    baselinePrice: z
      .number()
      .describe("The official price in this region for comparison"),
    currency: z.string().describe("The currency code, e.g. EUR"),
  }),
  execute: async (_ctx, _input) => {
    // TODO: implement TinyFish marketplace search
    return "TODO: implement searchMarketplace";
  },
});
