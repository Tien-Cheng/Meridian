"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Map, {
  Layer,
  Marker,
  Popup,
  Source,
  type LayerProps,
  type MapMouseEvent,
  type MapRef,
} from "react-map-gl/mapbox";
import {
  type GeoJSONFeature,
  LngLatBounds,
  type ExpressionSpecification,
} from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const INITIAL_VIEW_STATE = {
  longitude: 103.8198,
  latitude: 20,
  zoom: 2.2,
  pitch: 0,
  bearing: 0,
};

const ROUTE_LAYER_IDS = [
  "meridian-route-verified",
  "meridian-route-unverified",
  "meridian-route-hitbox",
];

function getRiskColor(riskLevel: "low" | "medium" | "high" | "critical") {
  if (riskLevel === "low") return "#10b981";
  if (riskLevel === "medium") return "#f59e0b";
  return "#ef4444";
}

function getRiskTextClass(riskLevel: "low" | "medium" | "high" | "critical") {
  if (riskLevel === "low") return "text-emerald-400";
  if (riskLevel === "medium") return "text-amber-400";
  return "text-red-400";
}

const routeWidthExpression: ExpressionSpecification = [
  "match",
  ["get", "riskLevel"],
  "critical",
  6,
  "high",
  5,
  "medium",
  4,
  3,
];

interface InvestigationMapProps {
  investigationId: Id<"investigations">;
  onSelectFinding: (findingId: Id<"findings"> | null) => void;
  selectedFindingId: Id<"findings"> | null;
}

function InvestigationMap({
  investigationId,
  onSelectFinding,
  selectedFindingId,
}: InvestigationMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const lastFitSignature = useRef<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const findingsQuery = useQuery(api.functions.findings.listByInvestigation, {
    investigationId,
  });
  const routesQuery = useQuery(api.functions.routes.listByInvestigation, {
    investigationId,
  });
  const [mapReady, setMapReady] = useState(false);
  const [routeAnimationProgress, setRouteAnimationProgress] = useState(0);
  const [hoveredFindingId, setHoveredFindingId] = useState<Id<"findings"> | null>(
    null
  );
  const [hoveredRouteId, setHoveredRouteId] = useState<Id<"supplyRoutes"> | null>(
    null
  );
  const [routePopupLocation, setRoutePopupLocation] = useState<{
    longitude: number;
    latitude: number;
  } | null>(null);
  const findings = useMemo(() => findingsQuery ?? [], [findingsQuery]);
  const routes = useMemo(() => routesQuery ?? [], [routesQuery]);

  const findingsById = useMemo(
    () =>
      Object.fromEntries(findings.map((finding) => [finding._id, finding])) as Record<
        string,
        (typeof findings)[number]
      >,
    [findings]
  );

  const routesById = useMemo(
    () =>
      Object.fromEntries(routes.map((route) => [route._id, route])) as Record<
        string,
        (typeof routes)[number]
      >,
    [routes]
  );

  const activeFinding =
    (selectedFindingId ? findingsById[selectedFindingId] : undefined) ??
    (hoveredFindingId ? findingsById[hoveredFindingId] : undefined);
  const activeRoute = hoveredRouteId ? routesById[hoveredRouteId] : undefined;

  const routeSourceData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: routes.map((route) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [route.fromLongitude, route.fromLatitude],
            [route.toLongitude, route.toLatitude],
          ],
        },
        properties: {
          routeId: route._id,
          verified: route.verified,
          riskLevel: route.riskLevel,
          concern: route.concern,
          fromRegion: route.fromRegion,
          toRegion: route.toRegion,
        },
      })),
    }),
    [routes]
  );

  const routeGradientVerified = useMemo(
    (): ExpressionSpecification => [
        "case",
        ["<=", ["line-progress"], routeAnimationProgress],
        "#ef4444",
        "rgba(239,68,68,0)",
      ],
    [routeAnimationProgress]
  );

  const routeGradientUnverified = useMemo(
    (): ExpressionSpecification => [
        "case",
        ["<=", ["line-progress"], routeAnimationProgress],
        "rgba(245,158,11,0.55)",
        "rgba(245,158,11,0)",
      ],
    [routeAnimationProgress]
  );

  const routeVerifiedLayer = useMemo(
    () =>
      ({
        id: "meridian-route-verified",
        type: "line",
        filter: ["==", ["get", "verified"], true],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-width": routeWidthExpression,
          "line-opacity": 0.95,
          "line-gradient": routeGradientVerified,
        },
      } as LayerProps),
    [routeGradientVerified]
  );

  const routeUnverifiedLayer = useMemo(
    () =>
      ({
        id: "meridian-route-unverified",
        type: "line",
        filter: ["==", ["get", "verified"], false],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-width": routeWidthExpression,
          "line-opacity": 0.5,
          "line-dasharray": [2, 2],
          "line-gradient": routeGradientUnverified,
        },
      } as LayerProps),
    [routeGradientUnverified]
  );

  const routeHitLayer = useMemo(
    () =>
      ({
        id: "meridian-route-hitbox",
        type: "line",
        paint: {
          "line-color": "rgba(0,0,0,0)",
          "line-width": 16,
        },
      } as LayerProps),
    []
  );

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

  useEffect(() => {
    if (routes.length === 0) {
      return;
    }

    const start = performance.now();
    const durationMs = 1200;

    const animate = (timestamp: number) => {
      const progress = Math.min((timestamp - start) / durationMs, 1);
      setRouteAnimationProgress(progress);
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [routes.length]);

  useEffect(() => {
    if (!mapReady || findings.length === 0) {
      return;
    }

    const bounds = new LngLatBounds();
    const points = [
      ...findings.map((finding) => [finding.longitude, finding.latitude] as [
        number,
        number,
      ]),
      ...routes.flatMap((route) => [
        [route.fromLongitude, route.fromLatitude] as [number, number],
        [route.toLongitude, route.toLatitude] as [number, number],
      ]),
    ];

    const signature = points.map(([lng, lat]) => `${lng}:${lat}`).join("|");
    if (signature.length === 0 || signature === lastFitSignature.current) {
      return;
    }

    for (const [longitude, latitude] of points) {
      bounds.extend([longitude, latitude]);
    }

    lastFitSignature.current = signature;
    if (points.length === 1) {
      mapRef.current?.flyTo({
        center: points[0],
        duration: 900,
        zoom: 4.4,
      });
      return;
    }

    mapRef.current?.fitBounds(bounds, {
      duration: 900,
      padding: {
        top: 72,
        right: 72,
        bottom: 72,
        left: 72,
      },
    });
  }, [findings, mapReady, routes]);

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

  const handleMarkerClick = (findingId: Id<"findings">) => {
    setHoveredRouteId(null);
    setRoutePopupLocation(null);
    onSelectFinding(findingId);
  };

  const handleRouteHover = (event: MapMouseEvent) => {
    const hoveredFeature = (event.features as GeoJSONFeature[] | undefined)?.find(
      (feature) =>
        typeof feature.layer?.id === "string" &&
        ROUTE_LAYER_IDS.includes(feature.layer.id)
    );

    if (!hoveredFeature?.properties?.routeId) {
      setHoveredRouteId(null);
      setRoutePopupLocation(null);
      return;
    }

    setHoveredRouteId(hoveredFeature.properties.routeId as Id<"supplyRoutes">);
    setRoutePopupLocation({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    });
  };

  return (
    <div className="absolute inset-0">
      <Map
        attributionControl={false}
        initialViewState={INITIAL_VIEW_STATE}
        interactiveLayerIds={ROUTE_LAYER_IDS}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
        onClick={() => {
          onSelectFinding(null);
          setHoveredRouteId(null);
          setRoutePopupLocation(null);
        }}
        onLoad={() => setMapReady(true)}
        onMouseMove={handleRouteHover}
        onMouseOut={() => {
          setHoveredRouteId(null);
          setRoutePopupLocation(null);
        }}
        ref={mapRef}
        style={{ width: "100%", height: "100%" }}
      >
        {routes.length > 0 ? (
          <Source
            data={routeSourceData}
            id="meridian-routes"
            lineMetrics
            type="geojson"
          >
            <Layer {...routeVerifiedLayer} />
            <Layer {...routeUnverifiedLayer} />
            <Layer {...routeHitLayer} />
          </Source>
        ) : null}

        {findings.map((finding) => {
          const isSelected = selectedFindingId === finding._id;
          const isHighlighted = hoveredFindingId === finding._id || isSelected;
          const isHotRisk =
            finding.riskLevel === "high" || finding.riskLevel === "critical";

          return (
            <Marker
              anchor="center"
              key={finding._id}
              latitude={finding.latitude}
              longitude={finding.longitude}
            >
              <button
                aria-label={finding.title}
                className={`relative flex size-5 items-center justify-center border border-zinc-950 transition-transform hover:scale-110 ${
                  isSelected ? "scale-110" : ""
                } ${isHotRisk ? "map-pulse" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleMarkerClick(finding._id);
                }}
                onMouseEnter={() => setHoveredFindingId(finding._id)}
                onMouseLeave={() => setHoveredFindingId((current) =>
                  current === finding._id ? null : current
                )}
                style={{
                  backgroundColor: getRiskColor(finding.riskLevel),
                  boxShadow: isHighlighted
                    ? "0 0 0 2px rgba(245,158,11,0.42)"
                    : "none",
                }}
                type="button"
              >
                <span className="h-1.5 w-1.5 bg-zinc-950" />
              </button>
            </Marker>
          );
        })}

        {activeFinding ? (
          <Popup
            anchor="bottom"
            className="meridian-popup"
            closeButton={false}
            closeOnClick={false}
            latitude={activeFinding.latitude}
            longitude={activeFinding.longitude}
            offset={18}
          >
            <div className="w-[min(18rem,calc(100vw-1.5rem))] max-w-full overflow-hidden px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  Listing Trace
                </p>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.18em] ${getRiskTextClass(activeFinding.riskLevel)}`}
                >
                  {activeFinding.riskLevel}
                </span>
              </div>
              <p className="mt-2 break-words text-sm text-zinc-100 [overflow-wrap:anywhere]">
                {activeFinding.title}
              </p>
              <div className="mt-3 space-y-1.5 font-mono text-[11px] text-zinc-400">
                <p className="break-words [overflow-wrap:anywhere]">
                  Seller: <span className="text-zinc-200">{activeFinding.sellerName}</span>
                </p>
                <p className="break-words [overflow-wrap:anywhere]">
                  Market: <span className="text-zinc-200">{activeFinding.marketplace}</span>
                </p>
                <p className="break-words [overflow-wrap:anywhere]">
                  Price:{" "}
                  <span className="text-zinc-200">
                    {activeFinding.currency} {activeFinding.listedPrice.toFixed(2)}
                  </span>
                </p>
                <p className="break-words [overflow-wrap:anywhere]">
                  Deviation:{" "}
                  <span className={getRiskTextClass(activeFinding.riskLevel)}>
                    {activeFinding.priceDeviation > 0 ? "+" : ""}
                    {activeFinding.priceDeviation.toFixed(1)}%
                  </span>
                </p>
                <p className="break-words [overflow-wrap:anywhere]">
                  Credentials:{" "}
                  <span className="text-zinc-200">
                    {activeFinding.hasPharmacyCredentials ? "Present" : "Missing"}
                  </span>
                </p>
                <p className="break-words [overflow-wrap:anywhere]">
                  Prescription gate:{" "}
                  <span className="text-zinc-200">
                    {activeFinding.requiresPrescriptionCheck
                      ? "Verified"
                      : "Not enforced"}
                  </span>
                </p>
              </div>
            </div>
          </Popup>
        ) : null}

        {activeRoute && routePopupLocation ? (
          <Popup
            anchor="bottom"
            className="meridian-popup"
            closeButton={false}
            closeOnClick={false}
            latitude={routePopupLocation.latitude}
            longitude={routePopupLocation.longitude}
            offset={14}
          >
            <div className="w-[min(18rem,calc(100vw-1.5rem))] max-w-full overflow-hidden px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                  Supply Route
                </p>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.18em] ${getRiskTextClass(activeRoute.riskLevel)}`}
                >
                  {activeRoute.riskLevel}
                </span>
              </div>
              <p className="mt-2 break-words font-mono text-xs text-zinc-100 [overflow-wrap:anywhere]">
                {activeRoute.fromRegion} → {activeRoute.toRegion}
              </p>
              <p className="mt-3 break-words text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">
                {activeRoute.concern}
              </p>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                {activeRoute.verified
                  ? "Confirmed via shipping verification"
                  : "Suspected from seller copy"}
              </p>
            </div>
          </Popup>
        ) : null}
      </Map>

      <div className="pointer-events-none absolute left-4 top-4 border border-zinc-800 bg-zinc-950/90 px-3 py-2">
        <p className="font-mono text-[11px] tracking-wider text-zinc-400">
          MAP ONLINE
        </p>
        <p className="font-mono text-xs text-zinc-200">{summary}</p>
      </div>
    </div>
  );
}

export default memo(InvestigationMap);

function MapFallback({
  label,
  summary,
}: {
  label: string;
  summary: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
      <div className="max-w-md border border-zinc-800 bg-zinc-900 px-6 py-5 text-center">
        <p className="mb-2 font-mono text-xs tracking-[0.2em] text-amber-500">
          MERIDIAN MAP
        </p>
        <p className="font-mono text-sm leading-relaxed text-zinc-300">
          {label}
        </p>
        <p className="mt-3 font-mono text-xs text-zinc-500">{summary}</p>
      </div>
    </div>
  );
}
