"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import dynamic from "next/dynamic";
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

export default function InvestigationPage() {
  const { id } = useParams();
  const investigationId = id as Id<"investigations">;
  const [selectedFindingId, setSelectedFindingId] = useState<
    Id<"findings"> | null
  >(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(
    DEFAULT_RIGHT_PANEL_WIDTH
  );
  const [bottomBarHeight, setBottomBarHeight] = useState(
    DEFAULT_BOTTOM_BAR_HEIGHT
  );

  const investigation = useQuery(api.functions.investigations.get, {
    id: investigationId,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedRightPanelWidth = window.localStorage.getItem(
      "meridian:rightPanelWidth"
    );
    const storedBottomBarHeight = window.localStorage.getItem(
      "meridian:bottomBarHeight"
    );

    if (storedRightPanelWidth) {
      const parsedWidth = Number(storedRightPanelWidth);
      if (!Number.isNaN(parsedWidth)) {
        setRightPanelWidth(
          clamp(parsedWidth, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH)
        );
      }
    }

    if (storedBottomBarHeight) {
      const parsedHeight = Number(storedBottomBarHeight);
      if (!Number.isNaN(parsedHeight)) {
        setBottomBarHeight(
          clamp(parsedHeight, MIN_BOTTOM_BAR_HEIGHT, MAX_BOTTOM_BAR_HEIGHT)
        );
      }
    }
  }, []);

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

  if (!investigation) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <p className="text-zinc-500 font-mono text-sm animate-pulse">
          LOADING INVESTIGATION...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 header-glow bg-zinc-950 shrink-0">
        <Link
          href="/"
          className="font-mono font-bold text-amber-500 tracking-widest text-sm hover:text-amber-400 transition-colors"
        >
          MERIDIAN
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
            <TinyFishMonitor investigationId={investigationId} />
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
