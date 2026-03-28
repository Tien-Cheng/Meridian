import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ListingExtraction } from "../../shared/schemas";
import { getCoordinates } from "./geocoding";

type RiskSignal = {
  signal: string;
  label: string;
  weight: number;
  evidence: string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pushSignal(
  signals: RiskSignal[],
  signal: string,
  label: string,
  weight: number,
  evidence: string
) {
  signals.push({ signal, label, weight, evidence });
}

export function assessListingRisk({
  legitimatePrice,
  listing,
  requiresPrescription,
}: {
  legitimatePrice: number;
  listing: ListingExtraction;
  requiresPrescription?: boolean;
}) {
  const priceDeviation =
    legitimatePrice > 0
      ? ((listing.price - legitimatePrice) / legitimatePrice) * 100
      : 0;

  const signals: RiskSignal[] = [];

  if (priceDeviation <= -50) {
    pushSignal(
      signals,
      "extreme_price_deviation",
      `Price ${Math.abs(priceDeviation).toFixed(1)}% below legitimate`,
      0.95,
      `Listed at ${listing.currency} ${listing.price.toFixed(2)} versus legitimate ${listing.currency} ${legitimatePrice.toFixed(2)}`
    );
  } else if (priceDeviation <= -30) {
    pushSignal(
      signals,
      "major_price_deviation",
      `Price ${Math.abs(priceDeviation).toFixed(1)}% below legitimate`,
      0.75,
      `Listed at ${listing.currency} ${listing.price.toFixed(2)} versus legitimate ${listing.currency} ${legitimatePrice.toFixed(2)}`
    );
  } else if (priceDeviation <= -15) {
    pushSignal(
      signals,
      "moderate_price_deviation",
      `Price ${Math.abs(priceDeviation).toFixed(1)}% below legitimate`,
      0.45,
      `Listed at ${listing.currency} ${listing.price.toFixed(2)} versus legitimate ${listing.currency} ${legitimatePrice.toFixed(2)}`
    );
  }

  if (listing.pharmacyBadgeVisible === false) {
    pushSignal(
      signals,
      "missing_pharmacy_credentials",
      "No visible pharmacy credentials",
      0.55,
      "TinyFish did not observe a pharmacy badge or credential marker on the listing."
    );
  }

  if (requiresPrescription !== false && listing.prescriptionRequired === false) {
    pushSignal(
      signals,
      "missing_prescription_gate",
      "Prescription check not visible",
      0.65,
      "The listing appeared to offer a regulated product without a visible prescription requirement."
    );
  }

  if (!listing.batchNumber) {
    pushSignal(
      signals,
      "missing_batch_number",
      "Batch number not visible",
      0.25,
      "TinyFish did not find a visible batch or lot identifier."
    );
  }

  if (!listing.expiryDate) {
    pushSignal(
      signals,
      "missing_expiry_date",
      "Expiry date not visible",
      0.2,
      "TinyFish did not find a visible expiry date."
    );
  }

  if (listing.sellerAccountAge) {
    const normalized = listing.sellerAccountAge.toLowerCase();
    if (
      normalized.includes("new") ||
      normalized.includes("month") ||
      normalized.includes("week")
    ) {
      pushSignal(
        signals,
        "new_seller_account",
        "Seller account appears newly created",
        0.3,
        `Seller account age observed as "${listing.sellerAccountAge}".`
      );
    }
  }

  if (listing.shippingInfo && /worldwide|international|global/i.test(listing.shippingInfo)) {
    pushSignal(
      signals,
      "cross_border_shipping_signal",
      "Listing advertises international shipping",
      0.3,
      listing.shippingInfo
    );
  }

  const riskScore = clamp01(
    signals.reduce((total, signal) => total + signal.weight, 0)
  );
  const riskLevel: "low" | "medium" | "high" | "critical" =
    riskScore >= 0.85
      ? "critical"
      : riskScore >= 0.65
        ? "high"
        : riskScore >= 0.35
          ? "medium"
          : "low";

  return {
    priceDeviation,
    riskLevel,
    riskScore,
    riskSignals:
      signals.length > 0
        ? signals
        : [
            {
              signal: "limited_risk_indicators",
              label: "Limited counterfeit risk indicators",
              weight: 0.1,
              evidence:
                "The listing did not surface strong counterfeit signals from the currently visible TinyFish evidence.",
            },
          ],
  };
}

export async function ensureFindingForListing(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  args: {
    investigationId: Id<"investigations">;
    threadId: string;
    marketplace: string;
    region: string;
    legitimatePrice: number;
    requiresPrescription?: boolean;
    listing: ListingExtraction;
  }
) {
  const existing = await ctx.runQuery(
    internal.functions.findings.getByInvestigationAndListingUrl,
    {
      investigationId: args.investigationId,
      listingUrl: args.listing.listingUrl,
    }
  );

  if (existing) {
    return {
      created: false,
      findingId: existing._id,
      finding: existing,
      risk: assessListingRisk({
        legitimatePrice: args.legitimatePrice,
        listing: args.listing,
        requiresPrescription: args.requiresPrescription,
      }),
    };
  }

  const { latitude, longitude } = getCoordinates(args.region);
  const risk = assessListingRisk({
    legitimatePrice: args.legitimatePrice,
    listing: args.listing,
    requiresPrescription: args.requiresPrescription,
  });

  const findingId = await ctx.runMutation(internal.functions.findings.create, {
    investigationId: args.investigationId,
    threadId: args.threadId,
    title: args.listing.title,
    marketplace: args.marketplace,
    region: args.region,
    sellerName: args.listing.sellerName,
    listedPrice: args.listing.price,
    currency: args.listing.currency,
    legitimatePrice: args.legitimatePrice,
    priceDeviation: risk.priceDeviation,
    listingUrl: args.listing.listingUrl,
    imageUrls:
      args.listing.imageUrls && args.listing.imageUrls.length > 0
        ? args.listing.imageUrls
        : undefined,
    latitude,
    longitude,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    riskSignals: risk.riskSignals,
    hasPharmacyCredentials: args.listing.pharmacyBadgeVisible,
    requiresPrescriptionCheck: args.requiresPrescription,
    prescriptionRequired: args.listing.prescriptionRequired,
    batchNumberVisible:
      args.listing.batchNumber !== undefined ? args.listing.batchNumber.length > 0 : undefined,
    expiryDateVisible:
      args.listing.expiryDate !== undefined ? args.listing.expiryDate.length > 0 : undefined,
    sellerVerificationBadge: args.listing.pharmacyBadgeVisible,
  });

  return {
    created: true,
    findingId,
    risk,
  };
}
