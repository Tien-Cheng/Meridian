import { createTool, type ToolCtx } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod/v4";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { callTinyFish, processTinyFishStream } from "../lib/tinyfish";
import { getCoordinates } from "../lib/geocoding";

const COUNTRY_TO_PROXY_CODE = new Map<string, string>([
  ["France", "FR"],
  ["Germany", "DE"],
  ["United Kingdom", "GB"],
  ["United States", "US"],
  ["Japan", "JP"],
  ["Australia", "AU"],
  ["Canada", "CA"],
  ["Singapore", "SG"],
  ["Italy", "IT"],
  ["Spain", "ES"],
  ["Netherlands", "NL"],
  ["South Korea", "KR"],
  ["Thailand", "TH"],
  ["Malaysia", "MY"],
  ["Indonesia", "ID"],
  ["Philippines", "PH"],
  ["Hong Kong", "HK"],
  ["Taiwan", "TW"],
  ["India", "IN"],
  ["China", "CN"],
]);

const BLOCKED_PATTERNS = [
  /access denied/i,
  /\b403\b/i,
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare/i,
  /datadome/i,
  /checking your browser/i,
  /security check/i,
  /blocked/i,
];

const ShippingVerificationResultSchema = z.object({
  canShip: z.boolean(),
  shipsFrom: z.string().nullable(),
  shipsTo: z.array(z.string()).nullable(),
  prescriptionCheckInFlow: z.boolean(),
  shippingCost: z.string().nullable(),
  evidence: z.string(),
});

export const ShippingVerificationSchema = z.object({
  shippingVerified: z.boolean(),
  shipsInternationally: z.boolean(),
  shippingOrigin: z.string().optional(),
  evidence: z.string(),
  requiresPrescriptionCheck: z.boolean().optional(),
});

export type ShippingVerificationResult = z.infer<
  typeof ShippingVerificationResultSchema
>;
export type ShippingVerification = z.infer<typeof ShippingVerificationSchema>;
type ShippingVerificationOutput = ShippingVerification | string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLooseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (
    ["true", "yes", "visible", "present", "required", "found", "1"].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    [
      "false",
      "no",
      "not visible",
      "absent",
      "not required",
      "not found",
      "0",
    ].includes(normalized)
  ) {
    return false;
  }

  return undefined;
}

function safeSerialize(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function extractJsonCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) candidates.add(trimmed);

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.add(candidate);
  }

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.add(text.slice(objectStart, objectEnd + 1).trim());
  }

  return [...candidates];
}

function looksBlocked(text: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

function withCaptchaLimitHint(message: string): string {
  if (!/captcha|recaptcha|hcaptcha/i.test(message)) return message;
  return `${message} TinyFish currently cannot solve CAPTCHA challenges automatically; stealth mode, proxy usage, and human-like goals reduce trigger rate but do not bypass an active CAPTCHA.`;
}

function describeFailure(result: unknown): string | undefined {
  if (typeof result === "string") {
    return looksBlocked(result)
      ? `TinyFish appears blocked by anti-bot protection: ${result.trim().slice(0, 240)}`
      : undefined;
  }

  if (!isRecord(result)) return undefined;

  const error = cleanString(result.error);
  const reason = cleanString(result.reason);
  const message = cleanString(result.message);
  const status = cleanString(result.status)?.toLowerCase();
  const combined = [error, reason, message].filter(Boolean).join(" ");

  if (error) {
    return `TinyFish reported an error: ${error}`;
  }

  if (status === "failure") {
    return combined
      ? `TinyFish reported failure: ${combined}`
      : "TinyFish reported failure while verifying shipping.";
  }

  if (combined && looksBlocked(combined)) {
    return `TinyFish appears blocked by anti-bot protection: ${combined}`;
  }

  return undefined;
}

function buildShippingVerificationGoal(input: {
  listingUrl: string;
  protectedMarket: string;
}): string {
  return [
    `1. Open this exact product listing URL first (not a search page): ${input.listingUrl}`,
    "2. Wait for the page to fully load. If popups appear (cookies, newsletter, region prompts), dismiss them using visible button text and wait 1 second.",
    "3. If a security check or 'checking your browser' screen appears, wait once for it to complete automatically.",
    '4. Click "Add to Cart" or the equivalent button. If the product has required options (size, quantity, variant), select the first available option before adding to cart.',
    "5. Once the item is added, navigate to the cart page. Look for a cart icon, cart link, or 'View Cart' button.",
    "6. On the cart page, look for a 'Proceed to Checkout', 'Checkout', or 'Buy Now' button and click it.",
    "7. If prompted to sign in or create an account, STOP. Do NOT create an account or provide personal information. Note that login is required.",
    `8. Look for shipping/delivery options or an address selection form. Check whether ${input.protectedMarket} appears as a shipping destination in any country dropdown or address form. Identify where the product ships FROM (origin country/region) if visible.`,
    "9. Check whether the checkout flow includes any prescription verification step, pharmacy license check, medical questionnaire, or age verification gate.",
    "10. Note any visible shipping cost or delivery estimate.",
    "11. Do NOT complete any purchase or provide any personal information beyond what is needed to see shipping options.",
    '12. If an Access Denied/403 page or CAPTCHA appears, return {"error":"blocked","reason":"brief explanation"}.',
    "13. Return only valid JSON with these keys: canShip (boolean - whether the item can ship to the target country), shipsFrom (string or null - origin country), shipsTo (array of country name strings or null), prescriptionCheckInFlow (boolean - whether checkout asks for Rx verification), shippingCost (string or null), loginRequired (boolean - whether sign-in blocked further progress), evidence (string - step-by-step description of what you observed).",
    `14. Target destination country: ${input.protectedMarket}.`,
  ].join("\n");
}

function hasShippingSignal(record: Record<string, unknown>): boolean {
  const keys = [
    "canShip",
    "can_ship",
    "shipsFrom",
    "ships_from",
    "shipsTo",
    "ships_to",
    "prescriptionCheckInFlow",
    "prescription_check_in_flow",
    "shippingCost",
    "shipping_cost",
    "evidence",
    "loginRequired",
    "login_required",
  ];
  return keys.some((key) => record[key] !== undefined);
}

function extractShippingCandidate(
  value: unknown,
  depth = 0
): Record<string, unknown> | undefined {
  if (depth > 4) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractShippingCandidate(item, depth + 1);
      if (candidate) return candidate;
    }
    return undefined;
  }

  if (!isRecord(value)) return undefined;
  if (hasShippingSignal(value)) return value;

  for (const key of ["result", "shipping", "data", "output", "details"]) {
    const nested = value[key];
    if (nested !== undefined) {
      const candidate = extractShippingCandidate(nested, depth + 1);
      if (candidate) return candidate;
    }
  }

  return undefined;
}

function normalizeShippingCandidate(
  candidate: Record<string, unknown>
): ShippingVerificationResult | null {
  const canShipRaw =
    parseLooseBoolean(candidate.canShip) ??
    parseLooseBoolean(candidate.can_ship);
  const canShip = canShipRaw ?? false;

  const shipsFrom =
    cleanString(candidate.shipsFrom) ??
    cleanString(candidate.ships_from) ??
    null;

  let shipsTo: string[] | null = null;
  const shipsToRaw = candidate.shipsTo ?? candidate.ships_to;
  if (Array.isArray(shipsToRaw)) {
    shipsTo = shipsToRaw
      .map((item) => (typeof item === "string" ? item.trim() : null))
      .filter((item): item is string => item !== null && item.length > 0);
    if (shipsTo.length === 0) shipsTo = null;
  } else if (typeof shipsToRaw === "string" && shipsToRaw.trim()) {
    shipsTo = shipsToRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (shipsTo.length === 0) shipsTo = null;
  }

  const prescriptionCheckInFlow =
    parseLooseBoolean(candidate.prescriptionCheckInFlow) ??
    parseLooseBoolean(candidate.prescription_check_in_flow) ??
    parseLooseBoolean(candidate.prescriptionCheck) ??
    false;

  const shippingCost =
    cleanString(candidate.shippingCost) ??
    cleanString(candidate.shipping_cost) ??
    null;

  const evidence =
    cleanString(candidate.evidence) ??
    cleanString(candidate.summary) ??
    cleanString(candidate.description) ??
    "No evidence description provided.";

  const loginRequired =
    parseLooseBoolean(candidate.loginRequired) ??
    parseLooseBoolean(candidate.login_required) ??
    false;

  const finalCanShip =
    loginRequired && canShipRaw === undefined ? false : canShip;

  const result: ShippingVerificationResult = {
    canShip: finalCanShip,
    shipsFrom,
    shipsTo,
    prescriptionCheckInFlow,
    shippingCost,
    evidence: loginRequired
      ? `[Login required - checkout blocked] ${evidence}`
      : evidence,
  };

  return ShippingVerificationResultSchema.safeParse(result).success
    ? result
    : null;
}

function parseShippingResult(
  rawResult: unknown
): ShippingVerificationResult | null {
  const directCandidate = extractShippingCandidate(rawResult);
  if (directCandidate) {
    const normalized = normalizeShippingCandidate(directCandidate);
    if (normalized) return normalized;
  }

  if (typeof rawResult !== "string") return null;

  for (const jsonCandidate of extractJsonCandidates(rawResult)) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const candidate = extractShippingCandidate(parsed);
      if (!candidate) continue;
      const normalized = normalizeShippingCandidate(candidate);
      if (normalized) return normalized;
    } catch {
      continue;
    }
  }

  return null;
}

function toWorkflowShippingVerification(
  parsed: ShippingVerificationResult
): ShippingVerification {
  return {
    shippingVerified: true,
    shipsInternationally: parsed.canShip,
    shippingOrigin: parsed.shipsFrom ?? undefined,
    evidence: parsed.evidence,
    requiresPrescriptionCheck: parsed.prescriptionCheckInFlow,
  };
}

async function performShippingVerification(input: {
  listingUrl: string;
  protectedMarket: string;
}): Promise<{
  parsed: ShippingVerificationResult | null;
  rawResult?: unknown;
  failure?: string;
}> {
  if (!process.env.TINYFISH_API_KEY) {
    return {
      parsed: null,
      failure:
        "TinyFish API key is missing. Set TINYFISH_API_KEY before running shipping verification.",
    };
  }

  const goal = buildShippingVerificationGoal(input);
  const destinationProxyCode = COUNTRY_TO_PROXY_CODE.get(input.protectedMarket);

  let response: Response;
  try {
    response = await callTinyFish({
      url: input.listingUrl,
      goal,
      browser_profile: "stealth",
      proxy_config: {
        enabled: true,
        ...(destinationProxyCode ? { country_code: destinationProxyCode } : {}),
      },
    });
  } catch (error) {
    return {
      parsed: null,
      failure: `TinyFish request failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return {
      parsed: null,
      failure: `TinyFish request failed with status ${response.status}: ${
        errorText.trim() || response.statusText || "no response body"
      }`,
    };
  }

  let rawResult: unknown;
  try {
    rawResult = await processTinyFishStream(response);
  } catch (error) {
    return {
      parsed: null,
      failure: `TinyFish streaming failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }

  const failure =
    describeFailure(rawResult) ||
    (typeof rawResult === "string"
      ? (() => {
          for (const candidate of extractJsonCandidates(rawResult)) {
            try {
              return describeFailure(JSON.parse(candidate) as unknown);
            } catch {
              continue;
            }
          }
          return undefined;
        })()
      : undefined);

  if (failure) {
    return {
      parsed: null,
      rawResult,
      failure: withCaptchaLimitHint(failure),
    };
  }

  return {
    parsed: parseShippingResult(rawResult),
    rawResult,
  };
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
  execute: async (ctx: ToolCtx, input): Promise<ShippingVerificationOutput> => {
    const findingId = input.findingId as Id<"findings">;
    const finding = await ctx.runQuery(internal.functions.findings.getById, {
      findingId,
    });

    if (!finding) {
      return `Finding ${input.findingId} not found in database.`;
    }

    const verification = await runShippingVerification({
      listingUrl: input.listingUrl,
      protectedMarket: input.protectedMarket,
    });

    await ctx.runMutation(internal.functions.findings.updateShippingVerification, {
      findingId,
      shippingVerified: verification.shippingVerified,
      shipsInternationally: verification.shipsInternationally,
      shippingOrigin: verification.shippingOrigin,
      shippingEvidence: verification.evidence,
      requiresPrescriptionCheck: verification.requiresPrescriptionCheck,
    });

    if (
      verification.shippingVerified &&
      verification.shipsInternationally &&
      verification.shippingOrigin
    ) {
      const fromCoords = getCoordinates(verification.shippingOrigin);
      const toCoords = getCoordinates(input.protectedMarket);
      if (fromCoords.latitude !== 0 || fromCoords.longitude !== 0) {
        await ctx.runMutation(internal.functions.routes.createRoute, {
          investigationId: finding.investigationId,
          findingId,
          fromRegion: verification.shippingOrigin,
          fromLatitude: fromCoords.latitude,
          fromLongitude: fromCoords.longitude,
          toRegion: input.protectedMarket,
          toLatitude: toCoords.latitude,
          toLongitude: toCoords.longitude,
          verified: true,
          verificationMethod: "cart_shipping_check",
          riskLevel: finding.riskLevel,
          concern: verification.requiresPrescriptionCheck
            ? `Confirmed shipping from ${verification.shippingOrigin} to ${input.protectedMarket}; checkout includes prescription verification`
            : `Rx drug shipped from ${verification.shippingOrigin} to ${input.protectedMarket} without prescription verification`,
        });
      }
    }

    return verification;
  },
});

export async function runShippingVerification(input: {
  listingUrl: string;
  protectedMarket: string;
}): Promise<ShippingVerification> {
  const { parsed, rawResult, failure } = await performShippingVerification(input);

  if (parsed) {
    return toWorkflowShippingVerification(parsed);
  }

  if (rawResult !== undefined) {
    try {
      const { object } = await generateObject({
        model: openai.chat("gpt-5.4-mini"),
        schema: ShippingVerificationSchema,
        prompt: [
          "Normalize the following shipping verification output into JSON.",
          "Return a JSON object with these exact keys: shippingVerified, shipsInternationally, shippingOrigin, evidence, requiresPrescriptionCheck.",
          "Set shippingVerified=true only if the raw output contains a direct confirmation or denial from the page/cart/checkout flow.",
          "If shipping could not be confirmed, set shippingVerified=false and explain why in evidence.",
          "",
          safeSerialize(rawResult),
        ].join("\n"),
        abortSignal: AbortSignal.timeout(30_000),
      });

      return ShippingVerificationSchema.parse(object);
    } catch {
      const rawSummary = safeSerialize(rawResult).trim().slice(0, 300);
      return {
        shippingVerified: false,
        shipsInternationally: false,
        evidence:
          failure ??
          `Shipping verification completed but no structured result could be parsed.${rawSummary ? ` Raw: ${rawSummary}` : ""}`,
      };
    }
  }

  return {
    shippingVerified: false,
    shipsInternationally: false,
    evidence: failure ?? "Shipping verification could not be completed.",
  };
}

export async function runVerifyShipping(input: {
  listingUrl: string;
  protectedMarket: string;
}): Promise<ShippingVerificationResult | string> {
  const { parsed, rawResult, failure } = await performShippingVerification(input);

  if (parsed) {
    return parsed;
  }

  if (failure) {
    return failure;
  }

  const rawSummary =
    rawResult === undefined ? "" : safeSerialize(rawResult).trim().slice(0, 300);
  return `TinyFish completed but no structured shipping details extracted.${
    rawSummary ? ` Raw: ${rawSummary}` : ""
  }`;
}
