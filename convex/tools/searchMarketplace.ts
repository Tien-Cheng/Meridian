import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";
import {
  type ListingExtraction,
} from "../../shared/schemas";
import {
  MarketplaceSearchError,
  runMarketplaceSearch,
} from "../lib/marketplaceSearch";

type SearchMarketplaceOutput = ListingExtraction[] | string;

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
  execute: async (ctx, input): Promise<SearchMarketplaceOutput> => {
    try {
      return await runMarketplaceSearch({
        marketplaceUrl: input.marketplaceUrl,
        searchQuery: input.searchQuery,
        baselinePrice: input.baselinePrice,
        currency: input.currency,
        extractorCtx: ctx,
      });
    } catch (error) {
      if (error instanceof MarketplaceSearchError) {
        return error.message;
      }
      return `Unexpected marketplace search failure: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    }
  },
});
