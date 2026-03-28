import { Doc, Id } from "../_generated/dataModel";
import { REGION_COORDINATES } from "./constants";

type DemoFinding = Omit<Doc<"findings">, "_id" | "_creationTime">;
type DemoRoute = Omit<Doc<"supplyRoutes">, "_id" | "_creationTime">;
type DemoDossier = Omit<Doc<"sellerDossiers">, "_id" | "_creationTime">;
type DemoCase = Omit<Doc<"cases">, "_id" | "_creationTime">;

const ozempicLegitimatePrice = 900;
const now = Date.now();

const urls = {
  amazonCritical:
    "https://www.amazon.com/dp/B0OZEMPICNORX1",
  amazonHigh:
    "https://www.amazon.com/dp/B0OZEMPICSTOCK2",
  amazonMedium:
    "https://www.amazon.com/dp/B0OZEMPICDEALS3",
  lazadaCritical:
    "https://www.lazada.sg/products/ozempic-semaglutide-1mg-pen-healthdirect-sg-i1234567890.html",
  lazadaHigh:
    "https://www.lazada.sg/products/semaglutide-injection-weight-management-healthdirect-sg-i1234567891.html",
  shopeeCritical:
    "https://shopee.sg/Ozempic-Semaglutide-Pen-1mg-No-Rx-Needed-i.12345678.87654321",
  shopeeLow:
    "https://shopee.sg/Semaglutide-Seller-Consultation-Listing-i.12345678.87654322",
  shopeeMedium:
    "https://shopee.sg/GLP-1-Weight-Loss-Support-Kit-i.12345678.87654323",
} as const;

export function getDemoFindings(args: {
  investigationId: Id<"investigations">;
  threadId: string;
}): DemoFinding[] {
  const us = REGION_COORDINATES["United States"];
  const sg = REGION_COORDINATES.Singapore;

  return [
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "Ozempic Semaglutide Pen 1mg - No Prescription Needed",
      marketplace: "Amazon US",
      region: "United States",
      sellerName: "PharmaDeals_US",
      listedPrice: 90,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -90,
      listingUrl: urls.amazonCritical,
      imageUrls: [
        "https://images-na.ssl-images-amazon.com/images/I/ozempic-demo-1.jpg",
      ],
      latitude: us.latitude,
      longitude: us.longitude,
      riskScore: 0.98,
      riskLevel: "critical",
      riskSignals: [
        {
          signal: "no_prescription_check",
          label: "No prescription check",
          weight: 0.28,
          evidence: "Listing copy explicitly states no prescription is needed.",
        },
        {
          signal: "extreme_price_deviation",
          label: "Extreme price deviation",
          weight: 0.3,
          evidence: "Price is roughly 90% below the legitimate monthly market price.",
        },
        {
          signal: "missing_batch_number",
          label: "Missing batch number",
          weight: 0.2,
          evidence: "Product photos do not show any batch or lot identifier.",
        },
        {
          signal: "missing_expiry_date",
          label: "Missing expiry date",
          weight: 0.2,
          evidence: "No expiry date is visible in the listing images or description.",
        },
      ],
      hasPharmacyCredentials: false,
      requiresPrescriptionCheck: false,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: false,
      sellerVerificationBadge: false,
      shippingVerified: true,
      shipsInternationally: true,
      shippingOrigin: "China",
      shippingEvidence: "Checkout flow showed international fulfillment from China.",
      sellerClusterId: "cluster-healthdirect",
      discoveredAt: now - 8_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "Semaglutide Weekly Injection - Fast Weight Loss Delivery",
      marketplace: "Amazon US",
      region: "United States",
      sellerName: "MedSupply_Direct",
      listedPrice: 180,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -80,
      listingUrl: urls.amazonHigh,
      imageUrls: [
        "https://images-na.ssl-images-amazon.com/images/I/ozempic-demo-2.jpg",
      ],
      latitude: us.latitude + 0.35,
      longitude: us.longitude - 0.8,
      riskScore: 0.89,
      riskLevel: "high",
      riskSignals: [
        {
          signal: "stock_photos",
          label: "Stock photography",
          weight: 0.18,
          evidence: "Images appear to be reused marketing shots instead of product photos.",
        },
        {
          signal: "no_pharmacy_license",
          label: "No pharmacy credentials",
          weight: 0.24,
          evidence: "Seller profile does not provide verifiable pharmacy licensing information.",
        },
        {
          signal: "extreme_price_deviation",
          label: "Extreme price deviation",
          weight: 0.24,
          evidence: "Pricing is far below expected US retail levels.",
        },
        {
          signal: "new_seller_account",
          label: "New seller account",
          weight: 0.14,
          evidence: "Seller account shows limited transaction history and sparse reviews.",
        },
      ],
      hasPharmacyCredentials: false,
      requiresPrescriptionCheck: false,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: false,
      sellerVerificationBadge: false,
      shippingVerified: true,
      shipsInternationally: true,
      shippingOrigin: "Hong Kong",
      shippingEvidence: "Seller quoted international dispatch from Hong Kong in Q&A.",
      discoveredAt: now - 7_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "GLP-1 Telehealth Referral Bundle",
      marketplace: "Amazon US",
      region: "United States",
      sellerName: "WellnessBridge_US",
      listedPrice: 810,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -10,
      listingUrl: urls.amazonMedium,
      imageUrls: [
        "https://images-na.ssl-images-amazon.com/images/I/ozempic-demo-3.jpg",
      ],
      latitude: us.latitude - 0.25,
      longitude: us.longitude + 0.55,
      riskScore: 0.46,
      riskLevel: "medium",
      riskSignals: [
        {
          signal: "ships_from_non_manufacturer_region",
          label: "Ships from non-manufacturer region",
          weight: 0.16,
          evidence: "Fulfillment notes indicate export routing through a third-party logistics provider.",
        },
        {
          signal: "missing_batch_number",
          label: "Missing batch number",
          weight: 0.12,
          evidence: "Images do not clearly expose batch coding.",
        },
      ],
      hasPharmacyCredentials: true,
      requiresPrescriptionCheck: true,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: true,
      sellerVerificationBadge: true,
      shippingVerified: false,
      shipsInternationally: false,
      discoveredAt: now - 6_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "Ozempic Semaglutide Injection Pen 1mg - HealthDirect SG",
      marketplace: "Lazada Singapore",
      region: "Singapore",
      sellerName: "HealthDirect_SG",
      listedPrice: 220,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -75.6,
      listingUrl: urls.lazadaCritical,
      imageUrls: [
        "https://img.lazcdn.com/g/ozempic-demo-1.jpg",
      ],
      latitude: sg.latitude,
      longitude: sg.longitude,
      riskScore: 0.94,
      riskLevel: "critical",
      riskSignals: [
        {
          signal: "no_pharmacy_license",
          label: "No pharmacy license",
          weight: 0.24,
          evidence: "Storefront does not display any Singapore HSA or pharmacy license details.",
        },
        {
          signal: "no_prescription_check",
          label: "No prescription check",
          weight: 0.22,
          evidence: "Buyer can proceed toward purchase without uploading any prescription.",
        },
        {
          signal: "ships_from_non_manufacturer_region",
          label: "Ships from non-manufacturer region",
          weight: 0.18,
          evidence: "Seller advertises fulfillment from mainland China for a temperature-sensitive Rx drug.",
        },
        {
          signal: "missing_expiry_date",
          label: "Missing expiry date",
          weight: 0.15,
          evidence: "Product photos do not show expiry information.",
        },
      ],
      hasPharmacyCredentials: false,
      requiresPrescriptionCheck: false,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: false,
      sellerVerificationBadge: false,
      shippingVerified: true,
      shipsInternationally: true,
      shippingOrigin: "China",
      shippingEvidence: "Checkout estimate indicates cross-border fulfillment from Shenzhen.",
      sellerClusterId: "cluster-healthdirect",
      discoveredAt: now - 5_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "Semaglutide Weight Management Starter Kit",
      marketplace: "Lazada Singapore",
      region: "Singapore",
      sellerName: "HealthDirect_SG",
      listedPrice: 340,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -62.2,
      listingUrl: urls.lazadaHigh,
      imageUrls: [
        "https://img.lazcdn.com/g/ozempic-demo-2.jpg",
      ],
      latitude: sg.latitude + 0.12,
      longitude: sg.longitude - 0.18,
      riskScore: 0.82,
      riskLevel: "high",
      riskSignals: [
        {
          signal: "stock_photos",
          label: "Stock photos",
          weight: 0.16,
          evidence: "Listing imagery matches the Shopee listing from a related seller.",
        },
        {
          signal: "description_similarity",
          label: "Template description reuse",
          weight: 0.16,
          evidence: "Description structure and warnings are nearly identical to another seller storefront.",
        },
        {
          signal: "extreme_price_deviation",
          label: "Severe price deviation",
          weight: 0.22,
          evidence: "Price remains far below normal Singapore legitimate acquisition cost.",
        },
      ],
      hasPharmacyCredentials: false,
      requiresPrescriptionCheck: false,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: true,
      sellerVerificationBadge: false,
      shippingVerified: true,
      shipsInternationally: true,
      shippingOrigin: "China",
      shippingEvidence: "Seller quotes 5-7 day arrival from a foreign warehouse.",
      sellerClusterId: "cluster-healthdirect",
      discoveredAt: now - 4_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "Ozempic Pen 1mg - No Rx Needed",
      marketplace: "Shopee Singapore",
      region: "Singapore",
      sellerName: "Health_Direct_Official",
      listedPrice: 150,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -83.3,
      listingUrl: urls.shopeeCritical,
      imageUrls: [
        "https://down-sg.img.susercontent.com/file/ozempic-demo-1",
      ],
      latitude: sg.latitude - 0.11,
      longitude: sg.longitude + 0.2,
      riskScore: 0.96,
      riskLevel: "critical",
      riskSignals: [
        {
          signal: "no_prescription_check",
          label: "No prescription check",
          weight: 0.24,
          evidence: "Listing advertises direct messaging for order confirmation with no Rx step.",
        },
        {
          signal: "extreme_price_deviation",
          label: "Extreme price deviation",
          weight: 0.28,
          evidence: "Price undercuts legitimate acquisition cost by more than 80%.",
        },
        {
          signal: "missing_batch_number",
          label: "Missing batch number",
          weight: 0.16,
          evidence: "No lot or batch coding is visible in any product photo.",
        },
        {
          signal: "new_seller_account",
          label: "New seller account",
          weight: 0.12,
          evidence: "Store account age and review volume are inconsistent with claimed volume.",
        },
      ],
      hasPharmacyCredentials: false,
      requiresPrescriptionCheck: false,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: false,
      sellerVerificationBadge: false,
      shippingVerified: true,
      shipsInternationally: true,
      shippingOrigin: "China",
      shippingEvidence: "Shipping estimate indicates arrival from Guangdong export facility.",
      sellerClusterId: "cluster-healthdirect",
      discoveredAt: now - 3_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "Semaglutide Consultation Listing",
      marketplace: "Shopee Singapore",
      region: "Singapore",
      sellerName: "ClinicWell_SG",
      listedPrice: 860,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -4.4,
      listingUrl: urls.shopeeLow,
      imageUrls: [
        "https://down-sg.img.susercontent.com/file/ozempic-demo-2",
      ],
      latitude: sg.latitude + 0.16,
      longitude: sg.longitude + 0.08,
      riskScore: 0.21,
      riskLevel: "low",
      riskSignals: [
        {
          signal: "telehealth_redirect",
          label: "External consultation flow",
          weight: 0.08,
          evidence: "Seller requires a telehealth intake before medication fulfillment.",
        },
      ],
      hasPharmacyCredentials: true,
      requiresPrescriptionCheck: true,
      prescriptionRequired: true,
      batchNumberVisible: true,
      expiryDateVisible: true,
      sellerVerificationBadge: true,
      shippingVerified: false,
      shipsInternationally: false,
      discoveredAt: now - 2_000,
    },
    {
      investigationId: args.investigationId,
      threadId: args.threadId,
      title: "GLP-1 Weight Loss Support Kit",
      marketplace: "Shopee Singapore",
      region: "Singapore",
      sellerName: "VitalSlimHub",
      listedPrice: 495,
      currency: "USD",
      legitimatePrice: ozempicLegitimatePrice,
      priceDeviation: -45,
      listingUrl: urls.shopeeMedium,
      imageUrls: [
        "https://down-sg.img.susercontent.com/file/ozempic-demo-3",
      ],
      latitude: sg.latitude - 0.18,
      longitude: sg.longitude - 0.1,
      riskScore: 0.59,
      riskLevel: "medium",
      riskSignals: [
        {
          signal: "ships_from_non_manufacturer_region",
          label: "Cross-border shipping route",
          weight: 0.14,
          evidence: "Seller notes offshore sourcing for rapid replenishment.",
        },
        {
          signal: "missing_expiry_date",
          label: "Expiry not visible",
          weight: 0.1,
          evidence: "Photos show packaging only from the front panel.",
        },
      ],
      hasPharmacyCredentials: false,
      requiresPrescriptionCheck: true,
      prescriptionRequired: true,
      batchNumberVisible: false,
      expiryDateVisible: false,
      sellerVerificationBadge: false,
      shippingVerified: true,
      shipsInternationally: true,
      shippingOrigin: "Malaysia",
      shippingEvidence: "Seller disclosed regional forwarding hub for fulfillment.",
      discoveredAt: now - 1_000,
    },
  ];
}

export function getDemoRoutes(args: {
  investigationId: Id<"investigations">;
  findingIdsByUrl: Record<string, Id<"findings">>;
}): DemoRoute[] {
  const china = REGION_COORDINATES.China;
  const singapore = REGION_COORDINATES.Singapore;
  const hongKong = REGION_COORDINATES["Hong Kong"];
  const unitedStates = REGION_COORDINATES["United States"];

  return [
    {
      investigationId: args.investigationId,
      findingId: args.findingIdsByUrl[urls.lazadaCritical],
      fromRegion: "China",
      fromLatitude: china.latitude,
      fromLongitude: china.longitude,
      toRegion: "Singapore",
      toLatitude: singapore.latitude,
      toLongitude: singapore.longitude,
      verified: true,
      verificationMethod: "checkout_flow",
      riskLevel: "high",
      concern:
        "Rx drug shipped internationally without prescription verification",
    },
    {
      investigationId: args.investigationId,
      findingId: args.findingIdsByUrl[urls.amazonHigh],
      fromRegion: "Hong Kong",
      fromLatitude: hongKong.latitude,
      fromLongitude: hongKong.longitude,
      toRegion: "United States",
      toLatitude: unitedStates.latitude,
      toLongitude: unitedStates.longitude,
      verified: false,
      verificationMethod: "seller_copy",
      riskLevel: "medium",
      concern:
        "Seller claims offshore stock with limited verification of cold-chain handling",
    },
  ];
}

export function getDemoDossiers(args: {
  investigationId: Id<"investigations">;
  findingIdsByUrl: Record<string, Id<"findings">>;
}): DemoDossier[] {
  const china = REGION_COORDINATES.China;
  const singapore = REGION_COORDINATES.Singapore;
  const unitedStates = REGION_COORDINATES["United States"];

  return [
    {
      investigationId: args.investigationId,
      clusterId: "cluster-healthdirect",
      sellerNames: ["HealthDirect_SG", "Health_Direct_Official"],
      marketplaces: ["Lazada Singapore", "Shopee Singapore"],
      regions: ["Singapore"],
      relatedListingIds: [
        args.findingIdsByUrl[urls.lazadaCritical],
        args.findingIdsByUrl[urls.lazadaHigh],
        args.findingIdsByUrl[urls.shopeeCritical],
      ],
      signals: {
        nameOverlap: true,
        imageReuse: true,
        descriptionSimilarity: true,
        catalogOverlap: true,
        sharedShippingOrigin: true,
      },
      confidenceScore: 0.93,
      networkRiskLevel: "critical",
      activeCountries: [
        {
          country: "Singapore",
          latitude: singapore.latitude,
          longitude: singapore.longitude,
        },
        {
          country: "China",
          latitude: china.latitude,
          longitude: china.longitude,
        },
      ],
    },
    {
      investigationId: args.investigationId,
      clusterId: "cluster-us-discounters",
      sellerNames: ["PharmaDeals_US", "MedSupply_Direct"],
      marketplaces: ["Amazon US"],
      regions: ["United States"],
      relatedListingIds: [
        args.findingIdsByUrl[urls.amazonCritical],
        args.findingIdsByUrl[urls.amazonHigh],
      ],
      signals: {
        nameOverlap: false,
        imageReuse: true,
        descriptionSimilarity: false,
        catalogOverlap: true,
        sharedShippingOrigin: false,
      },
      confidenceScore: 0.61,
      networkRiskLevel: "high",
      activeCountries: [
        {
          country: "United States",
          latitude: unitedStates.latitude,
          longitude: unitedStates.longitude,
        },
      ],
    },
  ];
}

export function getDemoCase(args: {
  investigationId: Id<"investigations">;
  threadId: string;
  findings: Array<Pick<
    Doc<"findings">,
    "_id" | "title" | "marketplace" | "sellerName" | "riskScore" | "riskLevel" | "riskSignals"
  >>;
  dossiers: Array<Pick<
    Doc<"sellerDossiers">,
    "clusterId" | "sellerNames" | "confidenceScore" | "networkRiskLevel"
  >>;
}): DemoCase {
  const suspiciousListings = args.findings.filter(
    (finding) => finding.riskLevel !== "low"
  );
  const highRiskListings = args.findings.filter(
    (finding) =>
      finding.riskLevel === "high" || finding.riskLevel === "critical"
  );

  return {
    investigationId: args.investigationId,
    threadId: args.threadId,
    title: "Meridian Demo Case: Suspected Counterfeit Ozempic Distribution",
    executiveSummary:
      "Meridian identified a cluster of high-risk semaglutide listings across Amazon US, Lazada Singapore, and Shopee Singapore. The strongest signals are extreme underpricing, absent prescription controls, missing batch/expiry metadata, and a linked Singapore storefront pair sourcing from mainland China.",
    publicHealthRiskAssessment:
      "This pattern is consistent with unauthorized cross-border distribution of a prescription injectable drug. The combination of absent pharmacy credentials, no prescription verification, offshore shipping origin, and lack of traceability indicators creates a material patient-safety risk.",
    totalListingsFound: args.findings.length,
    suspiciousListings: suspiciousListings.length,
    highRiskListings: highRiskListings.length,
    sellerNetworksIdentified: args.dossiers.length,
    findingSummaries: args.findings.map((finding) => ({
      findingId: finding._id,
      title: finding.title,
      marketplace: finding.marketplace,
      sellerName: finding.sellerName,
      riskScore: finding.riskScore,
      riskLevel: finding.riskLevel,
      topRiskSignals: finding.riskSignals
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((signal) => signal.label),
    })),
    sellerDossierSummaries: args.dossiers.map((dossier) => ({
      clusterId: dossier.clusterId,
      sellerNames: dossier.sellerNames,
      confidenceScore: dossier.confidenceScore,
      networkRiskLevel: dossier.networkRiskLevel,
      summary:
        dossier.clusterId === "cluster-healthdirect"
          ? "Cross-platform Singapore sellers share naming conventions, imagery, and shipping origin indicators suggesting a single operator."
          : "Amazon US discount sellers show partial overlap in catalog presentation and photo reuse but weaker operator linkage.",
    })),
    recommendedActions: [
      {
        action: "Escalate to marketplace trust and safety teams",
        priority: "high",
        detail:
          "Submit linked listing evidence and shipping-risk indicators for immediate removal review.",
        targetEntity: "Lazada Trust & Safety / Shopee Trust & Safety / Amazon Compliance",
      },
      {
        action: "Notify Singapore regulator",
        priority: "high",
        detail:
          "Escalate the Singapore storefront cluster for review of unlicensed prescription-drug selling.",
        targetEntity: "Singapore HSA",
      },
      {
        action: "Share counterfeit-risk intelligence with US stakeholders",
        priority: "medium",
        detail:
          "Flag the most extreme Amazon listings and linked international routes for brand-protection and regulatory follow-up.",
        targetEntity: "FDA",
      },
    ],
    generatedAt: now,
  };
}
