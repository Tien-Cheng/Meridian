import { createTool } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod/v4";
import { callTinyFish, processTinyFishStream } from "../lib/tinyfish";

export const ListingInspectionSchema = z.object({
  title: z.string().optional(),
  sellerName: z.string().optional(),
  sellerStorefrontUrl: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().optional(),
  shippingOrigin: z.string().optional(),
  pharmacyBadgeVisible: z.boolean().optional(),
  sellerVerificationBadge: z.boolean().optional(),
  prescriptionRequired: z.boolean().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
  sellerRating: z.number().optional(),
  sellerAccountAge: z.string().optional(),
  productDescriptionSnippet: z.string().optional(),
});

export type ListingInspection = z.infer<typeof ListingInspectionSchema>;

function buildInspectGoal(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): string {
  return [
    `1. Open this exact product listing page: ${input.listingUrl}.`,
    "2. Wait for the page to fully load and dismiss any visible cookie or newsletter popup.",
    "3. Scroll enough to inspect the seller section, delivery details, and product description.",
    "4. Extract these fields if visible: full product title, seller name, seller storefront URL, all product image URLs, shipping/delivery information, shipping origin, any pharmacy or verification badge, whether a prescription is required, any batch number, expiry date, seller rating, seller account age, and a short product description snippet.",
    "5. Use null or omit fields that are not visible. Do not invent values.",
    "6. Return only valid JSON with no markdown.",
    `7. Marketplace context: ${input.marketplace} in ${input.region}.`,
  ].join("\n");
}

function safeSerialize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export async function runListingInspection(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): Promise<ListingInspection> {
  if (!process.env.TINYFISH_API_KEY) {
    throw new Error("TinyFish API key is missing.");
  }

  const response = await callTinyFish({
    url: input.listingUrl,
    goal: buildInspectGoal(input),
    browser_profile: "stealth",
    proxy_config: { enabled: true },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `TinyFish inspect request failed with status ${response.status}: ${
        message.trim() || response.statusText || "no response body"
      }`
    );
  }

  const rawResult = await processTinyFishStream(response);

  if (typeof rawResult === "object" && rawResult !== null) {
    const parsed = ListingInspectionSchema.safeParse(rawResult);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const prompt = [
    "Normalize the following product listing inspection output into JSON.",
    "Return a JSON object with these optional keys only:",
    "title, sellerName, sellerStorefrontUrl, imageUrls, shippingInfo, shippingOrigin, pharmacyBadgeVisible, sellerVerificationBadge, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "Use arrays only for imageUrls. Omit fields you cannot confirm.",
    "",
    safeSerialize(rawResult),
  ].join("\n");

  const { object } = await generateObject({
    model: openai.chat("gpt-5.4-mini"),
    schema: ListingInspectionSchema,
    prompt,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return ListingInspectionSchema.parse(object);
}

export const inspectListing = createTool({
  description:
    "Open a specific listing page and extract detailed seller info, images, and shipping details",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to inspect"),
    marketplace: z.string().describe("The marketplace name, e.g. Amazon.de"),
    region: z.string().describe("The marketplace region, e.g. Germany"),
  }),
  execute: async (_ctx, input) => {
    return await runListingInspection(input);
  },
});
