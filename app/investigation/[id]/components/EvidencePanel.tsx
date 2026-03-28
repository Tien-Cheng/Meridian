"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface EvidencePanelProps {
  investigationId: Id<"investigations">;
  selectedFindingId: Id<"findings"> | null;
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
  const findingRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!selectedFindingId) {
      return;
    }
    findingRefs.current[selectedFindingId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [selectedFindingId]);

  type SignalKey = keyof (typeof dossiers)[number]["signals"];

  const signalLabels = useMemo(
    () =>
      ({
        nameOverlap: "Name overlap",
        imageReuse: "Image reuse",
        descriptionSimilarity: "Description similarity",
        catalogOverlap: "Catalog overlap",
        sharedShippingOrigin: "Shared shipping origin",
      }) satisfies Record<SignalKey, string>,
    []
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-6">
      {/* Findings Table */}
      <section>
        <h3 className="text-zinc-500 font-mono text-xs tracking-wider mb-3">
          FINDINGS ({findings.length})
        </h3>
        {findings.length === 0 ? (
          <p className="text-zinc-600 font-mono text-xs">
            No findings yet. Start an investigation.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {findings.map((f) => (
              <div
                key={f._id}
                ref={(node) => {
                  findingRefs.current[f._id] = node;
                }}
                className={`bg-zinc-900 border p-3 flex flex-col gap-1 transition-colors ${
                  selectedFindingId === f._id
                    ? "border-amber-500 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]"
                    : "border-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-zinc-100 font-mono text-xs truncate max-w-[200px]">
                    {f.title}
                  </span>
                  {f.riskLevel !== "low" && (
                    <span className="text-amber-400 font-mono text-xs font-bold">
                      {f.riskLevel.toUpperCase()}
                    </span>
                  )}
                  {f.shippingVerified && f.shipsInternationally && (
                    <span className="text-red-500 font-mono text-xs font-bold">
                      VIOLATION
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-zinc-500 font-mono text-xs">
                  <span>{f.marketplace}</span>
                  <span>{f.sellerName}</span>
                  <span>
                    {f.currency} {f.listedPrice.toFixed(2)}
                  </span>
                  <span
                    className={
                      f.riskLevel === "critical" || f.riskLevel === "high"
                        ? "text-red-400"
                        : "text-zinc-500"
                    }
                  >
                    {f.priceDeviation > 0 ? "+" : ""}
                    {f.priceDeviation.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Seller Dossiers */}
      <section>
        <h3 className="text-zinc-500 font-mono text-xs tracking-wider mb-3">
          SELLER DOSSIERS
        </h3>
        {dossiers.length === 0 ? (
          <p className="text-zinc-600 font-mono text-xs">
            No seller clusters identified yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {dossiers.map((dossier) => (
              <div
                key={dossier.clusterId}
                className="bg-zinc-900 border border-zinc-800 p-3 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-zinc-100 font-mono text-xs font-bold">
                      {dossier.sellerNames.join(" / ")}
                    </p>
                    <p className="text-zinc-500 font-mono text-xs mt-1">
                      {dossier.relatedListingIds.length} related listings ·{" "}
                      {dossier.activeCountries.map((country) => country.country).join(", ")}
                    </p>
                  </div>
                  <span
                    className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                      dossier.networkRiskLevel === "critical" ||
                      dossier.networkRiskLevel === "high"
                        ? "border-red-500/40 text-red-400"
                        : dossier.networkRiskLevel === "medium"
                          ? "border-amber-500/40 text-amber-400"
                          : "border-emerald-500/40 text-emerald-400"
                    }`}
                  >
                    {dossier.networkRiskLevel}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(
                    Object.entries(dossier.signals) as Array<[SignalKey, boolean]>
                  ).map(([signal, enabled]) => (
                    <span
                      key={signal}
                      className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
                        enabled
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-700 bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {signalLabels[signal]}
                    </span>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                    <span className="text-zinc-500">Confidence</span>
                    <span className="text-zinc-300">
                      {Math.round(dossier.confidenceScore * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-amber-500"
                      style={{
                        width: `${Math.round(dossier.confidenceScore * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
