"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface EvidencePanelProps {
  investigationId: Id<"investigations">;
}

export default function EvidencePanel({
  investigationId,
}: EvidencePanelProps) {
  const findings =
    useQuery(api.functions.findings.listByInvestigation, {
      investigationId,
    }) ?? [];

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
                className="bg-zinc-900 border border-zinc-800 p-3 flex flex-col gap-1"
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
        <p className="text-zinc-600 font-mono text-xs">
          Seller clusters will appear here after analysis.
        </p>
      </section>
    </div>
  );
}
