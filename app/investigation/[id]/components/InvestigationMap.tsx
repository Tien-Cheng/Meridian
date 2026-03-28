"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Map from "react-map-gl/mapbox";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, ArcLayer } from "@deck.gl/layers";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

// Severity color mapping (RGB arrays for deck.gl)
const COLORS = {
  normal: [16, 185, 129] as [number, number, number],      // emerald-500
  suspicious: [251, 191, 36] as [number, number, number],   // amber-400
  violation: [239, 68, 68] as [number, number, number],     // red-500
  route_unverified: [245, 158, 11, 128] as [number, number, number, number], // amber-500 50%
  route_verified: [239, 68, 68, 255] as [number, number, number, number],    // red-500
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

  const findingsLayer = new ScatterplotLayer({
    id: "findings",
    data: findings,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getRadius: 40000,
    getFillColor: (d: any) =>
      d.shipsToProtectedMarket
        ? COLORS.violation
        : d.isSuspicious
          ? COLORS.suspicious
          : COLORS.normal,
    radiusMinPixels: 6,
    radiusMaxPixels: 20,
    pickable: true,
  });

  const routesLayer = new ArcLayer({
    id: "routes",
    data: routes,
    getSourcePosition: (d: any) => [d.fromLongitude, d.fromLatitude],
    getTargetPosition: (d: any) => [d.toLongitude, d.toLatitude],
    getSourceColor: (d: any) =>
      d.verified ? COLORS.route_verified : COLORS.route_unverified,
    getTargetColor: (d: any) =>
      d.verified ? COLORS.route_verified : COLORS.route_unverified,
    getWidth: 2,
    pickable: true,
  });

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={[findingsLayer, routesLayer]}
      style={{ position: "absolute", inset: 0 }}
    >
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        attributionControl={false}
      />
    </DeckGL>
  );
}
