import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";

export const inspectListing = createTool({
  description:
    "Open a specific listing page and extract detailed seller info, images, and shipping details",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to inspect"),
    marketplace: z
      .string()
      .describe("The marketplace name, e.g. Amazon.de"),
    region: z.string().describe("The marketplace region, e.g. Germany"),
  }),
  execute: async (_ctx, _input) => {
    // TODO: implement TinyFish listing inspection
    return "TODO: implement inspectListing";
  },
});
