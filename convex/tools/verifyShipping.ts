import { createTool } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod/v4";
import { callTinyFish, processTinyFishStream } from "../lib/tinyfish";

export const ShippingVerificationSchema = z.object({
  shippingVerified: z.boolean(),
  shipsInternationally: z.boolean(),
  shippingOrigin: z.string().optional(),
  evidence: z.string(),
});

export type ShippingVerification = z.infer<typeof ShippingVerificationSchema>;

function buildShippingGoal(input: {
  listingUrl: string;
  protectedMarket: string;
}): string {
  return [
    `1. Open this exact product listing page: ${input.listingUrl}.`,
    "2. Wait for the page to load and dismiss any visible cookie or newsletter popup.",
    `3. Determine whether the seller can ship this listing to ${input.protectedMarket}.`,
    "4. If possible, use the page's shipping destination selector, delivery postcode flow, add-to-cart flow, or checkout/cart flow to test shipping eligibility without placing an order.",
    "5. Extract whether shipping to the target market is explicitly available, not available, or could not be verified.",
    "6. Extract shipping origin if visible.",
    "7. Return only valid JSON with fields: shippingVerified, shipsInternationally, shippingOrigin, evidence.",
    "8. Set shippingVerified=true only when the site explicitly confirms or denies shipment to the target market through the page or checkout/cart flow.",
    "9. If you cannot confirm shipping eligibility, set shippingVerified=false and explain why in evidence.",
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

export async function runShippingVerification(input: {
  listingUrl: string;
  protectedMarket: string;
}): Promise<ShippingVerification> {
  if (!process.env.TINYFISH_API_KEY) {
    throw new Error("TinyFish API key is missing.");
  }

  const response = await callTinyFish({
    url: input.listingUrl,
    goal: buildShippingGoal(input),
    browser_profile: "stealth",
    proxy_config: { enabled: true },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `TinyFish shipping verification failed with status ${response.status}: ${
        message.trim() || response.statusText || "no response body"
      }`
    );
  }

  const rawResult = await processTinyFishStream(response);

  if (typeof rawResult === "object" && rawResult !== null) {
    const parsed = ShippingVerificationSchema.safeParse(rawResult);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const prompt = [
    "Normalize the following shipping verification output into JSON.",
    "Return a JSON object with these exact keys: shippingVerified, shipsInternationally, shippingOrigin, evidence.",
    "Set shippingVerified=true only if the raw output contains a direct confirmation or denial from the page/cart/checkout flow.",
    "If shipping could not be confirmed, set shippingVerified=false and explain why in evidence.",
    "",
    safeSerialize(rawResult),
  ].join("\n");

  const { object } = await generateObject({
    model: openai.chat("gpt-5.4-mini"),
    schema: ShippingVerificationSchema,
    prompt,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return ShippingVerificationSchema.parse(object);
}

export const verifyShipping = createTool({
  description:
    "Verify whether a marketplace listing can actually ship to the protected market by testing the cart/checkout flow",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to verify"),
    protectedMarket: z
      .string()
      .describe("The country to check shipping to, e.g. France"),
    findingId: z
      .string()
      .describe("The ID of the finding to update with verification results"),
  }),
  execute: async (_ctx, input) => {
    return await runShippingVerification({
      listingUrl: input.listingUrl,
      protectedMarket: input.protectedMarket,
    });
  },
});
