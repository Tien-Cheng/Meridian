"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import RightPanel from "./components/RightPanel";
import TinyFishMonitor from "./components/TinyFishMonitor";
import ActivityLog from "./components/ActivityLog";

// deck.gl/mapbox must be client-only
const InvestigationMap = dynamic(
  () => import("./components/InvestigationMap"),
  { ssr: false }
);

const DEFAULT_RIGHT_PANEL_WIDTH = 420;
const DEFAULT_BOTTOM_BAR_HEIGHT = 180;
const MIN_RIGHT_PANEL_WIDTH = 340;
const MAX_RIGHT_PANEL_WIDTH = 760;
const MIN_BOTTOM_BAR_HEIGHT = 120;
const MAX_BOTTOM_BAR_HEIGHT = 360;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function loadStoredNumber(
  key: string,
  fallback: number,
  min: number,
  max: number
) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const storedValue = window.localStorage.getItem(key);
  if (!storedValue) {
    return fallback;
  }

  const parsedValue = Number(storedValue);
  if (Number.isNaN(parsedValue)) {
    return fallback;
  }

  return clamp(parsedValue, min, max);
}

export default function InvestigationPage() {
  const { id } = useParams();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const investigationId = id as Id<"investigations">;
  const [selectedFindingId, setSelectedFindingId] = useState<
    Id<"findings"> | null
  >(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    loadStoredNumber(
      "meridian:rightPanelWidth",
      DEFAULT_RIGHT_PANEL_WIDTH,
      MIN_RIGHT_PANEL_WIDTH,
      MAX_RIGHT_PANEL_WIDTH
    )
  );
  const [bottomBarHeight, setBottomBarHeight] = useState(() =>
    loadStoredNumber(
      "meridian:bottomBarHeight",
      DEFAULT_BOTTOM_BAR_HEIGHT,
      MIN_BOTTOM_BAR_HEIGHT,
      MAX_BOTTOM_BAR_HEIGHT
    )
  );

  const investigation = useQuery(api.functions.investigations.get, {
    id: investigationId,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/signin");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "meridian:rightPanelWidth",
      String(rightPanelWidth)
    );
  }, [rightPanelWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "meridian:bottomBarHeight",
      String(bottomBarHeight)
    );
  }, [bottomBarHeight]);

  const startHorizontalResize = (startX: number) => {
    const startWidth = rightPanelWidth;
    document.body.classList.add("cursor-col-resize", "select-none");

    const handleMove = (event: PointerEvent) => {
      const delta = event.clientX - startX;
      const nextWidth = clamp(
        startWidth - delta,
        MIN_RIGHT_PANEL_WIDTH,
        Math.min(MAX_RIGHT_PANEL_WIDTH, window.innerWidth - 360)
      );
      setRightPanelWidth(nextWidth);
    };

    const handleUp = () => {
      document.body.classList.remove("cursor-col-resize", "select-none");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const startVerticalResize = (startY: number) => {
    const startHeight = bottomBarHeight;
    document.body.classList.add("cursor-row-resize", "select-none");

    const handleMove = (event: PointerEvent) => {
      const delta = event.clientY - startY;
      const nextHeight = clamp(
        startHeight - delta,
        MIN_BOTTOM_BAR_HEIGHT,
        Math.min(MAX_BOTTOM_BAR_HEIGHT, window.innerHeight - 220)
      );
      setBottomBarHeight(nextHeight);
    };

    const handleUp = () => {
      document.body.classList.remove("cursor-row-resize", "select-none");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <p className="text-zinc-500 font-mono text-sm animate-pulse">
          INITIALIZING...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (investigation === undefined) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <p className="text-zinc-500 font-mono text-sm animate-pulse">
          LOADING INVESTIGATION...
        </p>
      </div>
    );
  }

  if (investigation === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-screen bg-zinc-950 px-6 text-center">
        <p className="text-zinc-300 font-mono text-sm">
          Investigation not found.
        </p>
        <Link
          href="/"
          className="text-amber-400 hover:text-amber-300 font-mono text-xs"
        >
          Back to Console
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 header-glow bg-zinc-950 shrink-0">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md border border-amber-500/25 bg-zinc-900 shadow-[0_0_18px_rgba(245,158,11,0.14)]">
            <Image
              alt="Meridian logo"
              className="h-full w-full scale-110 object-cover"
              height={36}
              priority
              src="/meridian-logo.png"
              width={36}
            />
          </span>
          <span className="font-mono font-bold text-amber-500 tracking-widest text-sm hover:text-amber-400 transition-colors">
            MERIDIAN
          </span>
        </Link>
        <span className="text-zinc-700 font-mono">·</span>
        <span className="text-zinc-400 font-mono text-xs">
          INV-{investigation._id.slice(-8).toUpperCase()}
        </span>
        <span className="text-zinc-700 font-mono">·</span>
        <span className="text-zinc-400 font-mono text-xs">
          {investigation.drugName || "UNTITLED"}
          {investigation.drugCategory && ` ${investigation.drugCategory}`}
        </span>
        <span className="text-zinc-700 font-mono">·</span>
        <InvestigationStatus status={investigation.status} />
      </header>

      <div className="flex flex-1 min-h-0 flex-col">
        {/* Main content: map + right panel */}
        <div className="flex flex-1 min-h-0">
          {/* Map area */}
          <div className="relative min-w-0 flex-1 grid-texture">
            <InvestigationMap
              investigationId={investigationId}
              onSelectFinding={setSelectedFindingId}
              selectedFindingId={selectedFindingId}
            />
          </div>

          <button
            aria-label="Resize map and right panel"
            className="group relative w-2 shrink-0 cursor-col-resize border-l border-r border-zinc-900 bg-zinc-950/80 hover:bg-zinc-900"
            onPointerDown={(event) => {
              event.preventDefault();
              startHorizontalResize(event.clientX);
            }}
            type="button"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800 transition-colors group-hover:bg-amber-500" />
          </button>

          {/* Right panel */}
          <div
            className="border-l border-zinc-800 flex flex-col shrink-0"
            style={{ width: rightPanelWidth }}
          >
            <RightPanel
              investigationId={investigationId}
              investigationContext={{
                drugName: investigation.drugName,
                protectedMarket: investigation.protectedMarket,
                regions: investigation.regions,
                sku: investigation.sku,
              }}
              investigationStatus={investigation.status}
              selectedFindingId={selectedFindingId}
              threadId={investigation.threadId}
            />
          </div>
        </div>

        <button
          aria-label="Resize lower monitor bar"
          className="group relative h-2 shrink-0 cursor-row-resize border-t border-b border-zinc-900 bg-zinc-950/80 hover:bg-zinc-900"
          onPointerDown={(event) => {
            event.preventDefault();
            startVerticalResize(event.clientY);
          }}
          type="button"
        >
          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-zinc-800 transition-colors group-hover:bg-amber-500" />
        </button>

        {/* Bottom bar: TinyFish monitor + activity log */}
        <div
          className="border-t border-zinc-800 flex shrink-0"
          style={{ height: bottomBarHeight }}
        >
          <div className="flex-1 flex gap-2 p-3 overflow-x-auto">
            <TinyFishMonitor
              investigationId={investigationId}
              regions={investigation.regions.map((region) => ({
                name: region.name,
                marketplace: region.marketplace,
              }))}
            />
          </div>
          <div className="w-[300px] border-l border-zinc-800">
            <ActivityLog investigationId={investigationId} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InvestigationStatus({ status }: { status: string }) {
  const label = status.toUpperCase().replace("_", " ");
  const dotColor =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "pending"
          ? "bg-zinc-500"
          : "bg-amber-500 animate-pulse";

  return (
    <span className="flex items-center gap-2">
      <span className={`w-2 h-2 ${dotColor}`} />
      <span className="text-zinc-400 font-mono text-xs">{label}</span>
    </span>
  );
}
