"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EvidencePanelProps {
  investigationId: Id<"investigations">;
  selectedFindingId: Id<"findings"> | null;
}

type SignalKey =
  | "nameOverlap"
  | "imageReuse"
  | "descriptionSimilarity"
  | "catalogOverlap"
  | "sharedShippingOrigin";

const signalLabels: Record<SignalKey, string> = {
  nameOverlap: "Name overlap",
  imageReuse: "Image reuse",
  descriptionSimilarity: "Description similarity",
  catalogOverlap: "Catalog overlap",
  sharedShippingOrigin: "Shared shipping origin",
};

type EvidenceArtifactDetail = Doc<"evidenceArtifacts"> & {
  screenshotUrl: string | null;
  payload: unknown;
  rawEvent: unknown;
};

type FindingDetailData = {
  finding: Doc<"findings">;
  artifacts: EvidenceArtifactDetail[];
  routes: Doc<"supplyRoutes">[];
};

type DossierDetailData = {
  dossier: Doc<"sellerDossiers">;
  findings: Doc<"findings">[];
  artifacts: EvidenceArtifactDetail[];
  routes: Doc<"supplyRoutes">[];
};

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) {
    return null;
  }

  return (
    <pre className="overflow-x-auto border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-3">
      <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </h4>
      {children}
    </section>
  );
}

function ArtifactTimeline({
  artifacts,
}: {
  artifacts: Array<{
    _id: string;
    capturedAt: number;
    currentUrl?: string | null;
    eventType: string;
    rawEvent?: unknown;
    screenshotUrl?: string | null;
    sourceTool: string;
    statusLabel: string;
    streamingUrl?: string | null;
    summaryText?: string | null;
  }>;
}) {
  if (artifacts.length === 0) {
    return (
      <p className="text-zinc-600 font-mono text-xs">
        No TinyFish artifact timeline captured yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {artifacts.map((artifact) => (
        <div
          key={artifact._id}
          className="border border-zinc-800 bg-zinc-950/70 p-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-500">
            <span>{artifact.sourceTool}</span>
            <span className="text-zinc-700">·</span>
            <span>{artifact.eventType}</span>
            <span className="text-zinc-700">·</span>
            <span>{formatTimestamp(artifact.capturedAt)}</span>
          </div>
          <p className="mt-2 text-sm text-zinc-100">{artifact.statusLabel}</p>
          {artifact.summaryText ? (
            <p className="mt-1 text-xs text-zinc-400">{artifact.summaryText}</p>
          ) : null}
          {artifact.currentUrl ? (
            <a
              className="mt-2 block break-all text-xs text-amber-400 underline-offset-2 hover:text-amber-300 hover:underline"
              href={artifact.currentUrl}
              rel="noreferrer"
              target="_blank"
            >
              {artifact.currentUrl}
            </a>
          ) : null}
          {artifact.streamingUrl ? (
            <a
              className="mt-2 block break-all text-xs text-amber-400 underline-offset-2 hover:text-amber-300 hover:underline"
              href={artifact.streamingUrl}
              rel="noreferrer"
              target="_blank"
            >
              {artifact.streamingUrl}
            </a>
          ) : null}
          {artifact.screenshotUrl ? (
            <img
              alt={artifact.statusLabel}
              className="mt-3 max-h-56 w-full border border-zinc-800 object-cover"
              src={artifact.screenshotUrl}
            />
          ) : null}
          {artifact.rawEvent ? (
            <div className="mt-3">
              <JsonBlock value={artifact.rawEvent} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FindingDetail({
  detail,
}: {
  detail: FindingDetailData;
}) {
  const screenshots = detail.artifacts.filter((artifact) => artifact.screenshotUrl);

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-mono text-zinc-100">{detail.finding.title}</h3>
          <span
            className={`border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] ${
              detail.finding.riskLevel === "critical" ||
              detail.finding.riskLevel === "high"
                ? "border-red-500/40 text-red-400"
                : detail.finding.riskLevel === "medium"
                  ? "border-amber-500/40 text-amber-400"
                  : "border-emerald-500/40 text-emerald-400"
            }`}
          >
            {detail.finding.riskLevel}
          </span>
          {detail.finding.shippingVerified && detail.finding.shipsInternationally ? (
            <span className="border border-red-500/40 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-red-400">
              violation
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          {detail.finding.marketplace} · {detail.finding.sellerName} · discovered{" "}
          {formatTimestamp(detail.finding.discoveredAt)}
        </p>
      </div>

      <Section title={`Screenshots (${screenshots.length})`}>
        {screenshots.length === 0 ? (
          <p className="text-zinc-600 font-mono text-xs">
            No screenshots captured for this evidence yet.
          </p>
        ) : (
          <div className="grid gap-3">
            {screenshots.map((artifact) => (
              <div
                key={artifact._id}
                className="border border-zinc-800 bg-zinc-950/70 p-2"
              >
                <img
                  alt={artifact.statusLabel}
                  className="h-56 w-full object-cover"
                  src={artifact.screenshotUrl ?? undefined}
                />
                <p className="mt-2 text-xs text-zinc-400">
                  {artifact.statusLabel} · {formatTimestamp(artifact.capturedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Listing Detail">
        <div className="grid gap-2 text-xs text-zinc-300">
          <p>URL: {detail.finding.listingUrl}</p>
          <p>
            Price: {detail.finding.currency} {detail.finding.listedPrice.toFixed(2)} vs{" "}
            {detail.finding.currency} {detail.finding.legitimatePrice.toFixed(2)}
          </p>
          <p>Price deviation: {detail.finding.priceDeviation.toFixed(1)}%</p>
          <p>Risk score: {Math.round(detail.finding.riskScore * 100)}%</p>
          {detail.finding.shippingOrigin ? (
            <p>Shipping origin: {detail.finding.shippingOrigin}</p>
          ) : null}
          {detail.finding.shippingEvidence ? (
            <p>Shipping evidence: {detail.finding.shippingEvidence}</p>
          ) : null}
          {detail.finding.productDescription ? (
            <p>Description: {detail.finding.productDescription}</p>
          ) : null}
          {detail.finding.sellerStorefrontUrl ? (
            <p>Storefront: {detail.finding.sellerStorefrontUrl}</p>
          ) : null}
        </div>
      </Section>

      <Section title="Risk Signals">
        <div className="flex flex-col gap-2">
          {detail.finding.riskSignals.map((signal) => (
            <div key={signal.signal} className="border border-zinc-800 bg-zinc-950/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-mono text-zinc-100">{signal.label}</p>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
                  {Math.round(signal.weight * 100)}%
                </span>
              </div>
              <p className="mt-2 text-xs text-zinc-400">{signal.evidence}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`TinyFish Timeline (${detail.artifacts.length})`}>
        <ArtifactTimeline artifacts={detail.artifacts} />
      </Section>

      <Section title="Routes">
        {detail.routes.length === 0 ? (
          <p className="text-zinc-600 font-mono text-xs">
            No supply route entries recorded for this finding yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.routes.map((route) => (
              <div key={route._id} className="border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs text-zinc-100">
                  {route.fromRegion} → {route.toRegion}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {route.verificationMethod} · {route.riskLevel} · {route.concern}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Raw Payloads">
        <div className="flex flex-col gap-3">
          {detail.artifacts
            .filter((artifact) => artifact.payload != null)
            .map((artifact) => (
              <div key={artifact._id}>
                <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-500">
                  {artifact.statusLabel}
                </p>
                <JsonBlock value={artifact.payload} />
              </div>
            ))}
        </div>
      </Section>
    </div>
  );
}

function DossierDetail({
  detail,
}: {
  detail: DossierDetailData;
}) {
  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-mono text-zinc-100">
            {detail.dossier.sellerNames.join(" / ")}
          </h3>
          <span className="border border-amber-500/40 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
            {Math.round(detail.dossier.confidenceScore * 100)}% confidence
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          {detail.dossier.marketplaces.join(", ")} · {detail.dossier.regions.join(", ")}
        </p>
      </div>

      <Section title="Cluster Signals">
        <div className="flex flex-wrap gap-2">
          {(Object.entries(detail.dossier.signals) as Array<[SignalKey, boolean]>).map(
            ([signal, enabled]) => (
              <span
                key={signal}
                className={`border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] ${
                  enabled
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500"
                }`}
              >
                {signalLabels[signal]}
              </span>
            )
          )}
        </div>
      </Section>

      <Section title={`Linked Findings (${detail.findings.length})`}>
        <div className="flex flex-col gap-2">
          {detail.findings.map((finding) => (
            <div key={finding._id} className="border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs font-mono text-zinc-100">{finding.title}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {finding.marketplace} · {finding.sellerName} · {finding.riskLevel}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`TinyFish Timeline (${detail.artifacts.length})`}>
        <ArtifactTimeline artifacts={detail.artifacts} />
      </Section>

      <Section title="Routes">
        {detail.routes.length === 0 ? (
          <p className="text-zinc-600 font-mono text-xs">
            No related supply route entries recorded for this dossier yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.routes.map((route) => (
              <div key={route._id} className="border border-zinc-800 bg-zinc-950/70 p-3">
                <p className="text-xs text-zinc-100">
                  {route.fromRegion} → {route.toRegion}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {route.verificationMethod} · {route.riskLevel} · {route.concern}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Raw Payloads">
        <div className="flex flex-col gap-3">
          {detail.artifacts
            .filter((artifact) => artifact.payload != null)
            .map((artifact) => (
              <div key={artifact._id}>
                <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-500">
                  {artifact.statusLabel}
                </p>
                <JsonBlock value={artifact.payload} />
              </div>
            ))}
        </div>
      </Section>
    </div>
  );
}

export default function EvidencePanel({
  investigationId,
  selectedFindingId,
}: EvidencePanelProps) {
  const findings =
    useQuery(api.functions.findings.listByInvestigation, {
      investigationId,
    }) ?? [];
  const dossiers =
    useQuery(api.functions.sellerDossiers.listByInvestigation, {
      investigationId,
    }) ?? [];
  const [manualFindingId, setManualFindingId] = useState<Id<"findings"> | null>(
    null
  );
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [dismissedSelectedFindingId, setDismissedSelectedFindingId] =
    useState<Id<"findings"> | null>(null);
  const findingRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeFindingId =
    selectedFindingId && selectedFindingId !== dismissedSelectedFindingId
      ? selectedFindingId
      : activeClusterId
        ? null
        : manualFindingId;

  useEffect(() => {
    if (!selectedFindingId) {
      return;
    }
    findingRefs.current[selectedFindingId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [selectedFindingId]);

  const findingDetail = useQuery(
    api.functions.evidence.getFindingDetail,
    activeFindingId ? { findingId: activeFindingId } : "skip"
  );
  const dossierDetail = useQuery(
    api.functions.evidence.getDossierDetail,
    activeClusterId ? { investigationId, clusterId: activeClusterId } : "skip"
  );

  const activeType = activeFindingId ? "finding" : activeClusterId ? "dossier" : null;
  const activeTitle = useMemo(() => {
    if (activeType === "finding" && findingDetail) {
      return findingDetail.finding.title;
    }
    if (activeType === "dossier" && dossierDetail) {
      return dossierDetail.dossier.sellerNames.join(" / ");
    }
    return "Evidence detail";
  }, [activeType, dossierDetail, findingDetail]);

  return (
    <>
      <div className="hidden h-full min-h-0 md:grid md:grid-cols-[minmax(0,0.95fr)_minmax(340px,1.05fr)]">
        <div className="min-h-0 overflow-y-auto p-4">
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-xs font-mono tracking-wider text-zinc-500">
                FINDINGS ({findings.length})
              </h3>
              {findings.length === 0 ? (
                <p className="text-zinc-600 font-mono text-xs">
                  No findings yet. Start an investigation.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {findings.map((finding) => (
                    <button
                      key={finding._id}
                      ref={(node) => {
                        findingRefs.current[finding._id] = node;
                      }}
                      className={`border p-3 text-left transition-colors ${
                        activeFindingId === finding._id
                          ? "border-amber-500 bg-zinc-900 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]"
                          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                      }`}
                      onClick={() => {
                        setManualFindingId(finding._id);
                        setActiveClusterId(null);
                        setDismissedSelectedFindingId(selectedFindingId ?? null);
                      }}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="max-w-[220px] truncate text-xs font-mono text-zinc-100">
                          {finding.title}
                        </span>
                        <div className="flex items-center gap-2">
                          {finding.riskLevel !== "low" ? (
                            <span className="text-xs font-mono font-bold text-amber-400">
                              {finding.riskLevel.toUpperCase()}
                            </span>
                          ) : null}
                          {finding.shippingVerified && finding.shipsInternationally ? (
                            <span className="text-xs font-mono font-bold text-red-500">
                              VIOLATION
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-500">
                        <span>{finding.marketplace}</span>
                        <span>{finding.sellerName}</span>
                        <span>
                          {finding.currency} {finding.listedPrice.toFixed(2)}
                        </span>
                        <span
                          className={
                            finding.riskLevel === "critical" ||
                            finding.riskLevel === "high"
                              ? "text-red-400"
                              : "text-zinc-500"
                          }
                        >
                          {finding.priceDeviation > 0 ? "+" : ""}
                          {finding.priceDeviation.toFixed(1)}%
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-3 text-xs font-mono tracking-wider text-zinc-500">
                SELLER DOSSIERS ({dossiers.length})
              </h3>
              {dossiers.length === 0 ? (
                <p className="text-zinc-600 font-mono text-xs">
                  No seller clusters identified yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {dossiers.map((dossier) => (
                    <button
                      key={dossier.clusterId}
                      className={`border p-3 text-left transition-colors ${
                        activeClusterId === dossier.clusterId
                          ? "border-amber-500 bg-zinc-900 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]"
                          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                      }`}
                      onClick={() => {
                        setActiveClusterId(dossier.clusterId);
                        setManualFindingId(null);
                        setDismissedSelectedFindingId(selectedFindingId ?? null);
                      }}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono font-bold text-zinc-100">
                            {dossier.sellerNames.join(" / ")}
                          </p>
                          <p className="mt-1 text-xs font-mono text-zinc-500">
                            {dossier.relatedListingIds.length} related listings ·{" "}
                            {dossier.activeCountries.map((country) => country.country).join(", ")}
                          </p>
                        </div>
                        <span className="border border-amber-500/40 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-400">
                          {dossier.networkRiskLevel}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {(Object.entries(dossier.signals) as Array<[SignalKey, boolean]>).map(
                          ([signal, enabled]) => (
                            <span
                              key={signal}
                              className={`border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] ${
                                enabled
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                  : "border-zinc-700 bg-zinc-800 text-zinc-500"
                              }`}
                            >
                              {signalLabels[signal]}
                            </span>
                          )
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950/70 p-4">
          {activeType === "finding" && findingDetail ? (
            <FindingDetail detail={findingDetail} />
          ) : null}
          {activeType === "dossier" && dossierDetail ? (
            <DossierDetail detail={dossierDetail} />
          ) : null}
          {!activeType ? (
            <div className="flex h-full items-center justify-center border border-dashed border-zinc-800 bg-zinc-950/70 p-8 text-center">
              <p className="text-zinc-500 font-mono text-xs">
                Select a finding or seller dossier to inspect screenshots, logs,
                timestamps, raw TinyFish output, and linked evidence.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="h-full overflow-y-auto p-4 md:hidden">
        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-xs font-mono tracking-wider text-zinc-500">
              FINDINGS ({findings.length})
            </h3>
            <div className="flex flex-col gap-1">
              {findings.map((finding) => (
                <button
                  key={finding._id}
                  className="border border-zinc-800 bg-zinc-900 p-3 text-left"
                  onClick={() => {
                    setManualFindingId(finding._id);
                    setActiveClusterId(null);
                    setDismissedSelectedFindingId(selectedFindingId ?? null);
                  }}
                  type="button"
                >
                  <p className="text-xs font-mono text-zinc-100">{finding.title}</p>
                  <p className="mt-1 text-xs font-mono text-zinc-500">
                    {finding.marketplace} · {finding.sellerName}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-mono tracking-wider text-zinc-500">
              SELLER DOSSIERS ({dossiers.length})
            </h3>
            <div className="flex flex-col gap-3">
              {dossiers.map((dossier) => (
                <button
                  key={dossier.clusterId}
                  className="border border-zinc-800 bg-zinc-900 p-3 text-left"
                  onClick={() => {
                    setActiveClusterId(dossier.clusterId);
                    setManualFindingId(null);
                    setDismissedSelectedFindingId(selectedFindingId ?? null);
                  }}
                  type="button"
                >
                  <p className="text-xs font-mono text-zinc-100">
                    {dossier.sellerNames.join(" / ")}
                  </p>
                  <p className="mt-1 text-xs font-mono text-zinc-500">
                    {dossier.relatedListingIds.length} related listings
                  </p>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <Dialog
        open={Boolean(activeType)}
        onOpenChange={(open) => {
          if (!open) {
            setManualFindingId(null);
            setActiveClusterId(null);
            setDismissedSelectedFindingId(selectedFindingId ?? null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-[calc(100%-1rem)] overflow-y-auto rounded-none border border-zinc-800 bg-zinc-950 p-4 text-zinc-100 md:hidden">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm text-zinc-100">
              {activeTitle}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-zinc-500">
              Evidence detail with TinyFish screenshots, activity logs,
              timestamps, and structured payloads.
            </DialogDescription>
          </DialogHeader>
          {activeType === "finding" && findingDetail ? (
            <FindingDetail detail={findingDetail} />
          ) : null}
          {activeType === "dossier" && dossierDetail ? (
            <DossierDetail detail={dossierDetail} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
