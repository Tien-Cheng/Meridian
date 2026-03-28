"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Map from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

interface InvestigationMapProps {
  investigationId: Id<"investigations">;
}

export default function InvestigationMap({
  investigationId,
}: InvestigationMapProps) {
  const findings =
    useQuery(api.functions.findings.listByInvestigation, {
      investigationId,
    }) ?? [];
  const routes =
    useQuery(api.functions.routes.listByInvestigation, {
      investigationId,
    }) ?? [];

  const summary = [
    `${findings.length} findings`,
    `${routes.length} supply routes`,
  ].join("  ·  ");
  const hasWebGL =
    typeof document !== "undefined" &&
    Boolean(
      document.createElement("canvas").getContext("webgl2") ??
        document.createElement("canvas").getContext("webgl")
    );

  if (!MAPBOX_TOKEN) {
    return (
      <MapFallback
        label="Map disabled: NEXT_PUBLIC_MAPBOX_TOKEN is missing."
        summary={summary}
      />
    );
  }

  if (!hasWebGL) {
    return (
      <MapFallback
        label="WebGL unavailable on this browser session. Investigation data is still available in the side panels."
        summary={summary}
      />
    );
  }

  return (
    <div className="absolute inset-0">
      <Map
        initialViewState={INITIAL_VIEW_STATE}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
      />

      <div className="pointer-events-none absolute left-4 top-4 border border-zinc-800 bg-zinc-950/90 px-3 py-2">
        <p className="text-zinc-400 font-mono text-[11px] tracking-wider">
          MAP ONLINE
        </p>
        <p className="text-zinc-200 font-mono text-xs">{summary}</p>
      </div>
    </div>
  );
}

function MapFallback({
  label,
  summary,
}: {
  label: string;
  summary: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
      <div className="border border-zinc-800 bg-zinc-900 px-6 py-5 max-w-md text-center">
        <p className="text-amber-500 font-mono text-xs tracking-[0.2em] mb-2">
          MERIDIAN MAP
        </p>
        <p className="text-zinc-300 font-mono text-sm leading-relaxed">
          {label}
        </p>
        <p className="text-zinc-500 font-mono text-xs mt-3">{summary}</p>
      </div>
    </div>
  );
}
