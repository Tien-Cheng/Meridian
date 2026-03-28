"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";


export default function Home() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <p className="text-zinc-500 font-mono text-sm animate-pulse">
          INITIALIZING...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    router.push("/signin");
    return null;
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        <div className="text-center flex flex-col items-center gap-2">
          <h2 className="text-zinc-100 font-mono text-lg tracking-wide">
            INVESTIGATION CONSOLE
          </h2>
          <p className="text-zinc-500 font-mono text-sm max-w-md">
            Launch a new investigation to detect unauthorized cross-border
            marketplace sellers.
          </p>
        </div>
        <NewInvestigationButton />
        <RecentInvestigations />
      </main>
    </div>
  );
}

function Header() {
  const { signOut } = useAuthActions();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-10 bg-zinc-950 px-6 py-4 header-glow flex items-center justify-between">
      <h1 className="font-mono font-bold text-amber-500 tracking-widest text-lg">
        MERIDIAN
      </h1>
      <button
        className="text-zinc-500 hover:text-zinc-300 font-mono text-xs cursor-pointer transition-colors"
        onClick={() => void signOut().then(() => router.push("/signin"))}
      >
        SIGN OUT
      </button>
    </header>
  );
}

function NewInvestigationButton() {
  const createInvestigation = useMutation(api.functions.investigations.create);
  const createNewThread = useMutation(api.functions.chat.createNewThread);
  const router = useRouter();

  const handleNew = async () => {
    const threadId = await createNewThread();
    const id = await createInvestigation({
      threadId,
      drugName: "",
      drugCategory: "",
      regions: [],
      regulatoryContext: "",
    });
    router.push(`/investigation/${id}`);
  };

  return (
    <button
      className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-mono font-bold px-8 py-3 transition-colors cursor-pointer text-sm tracking-wider"
      onClick={() => void handleNew()}
    >
      + NEW INVESTIGATION
    </button>
  );
}

function RecentInvestigations() {
  const investigations = useQuery(api.functions.investigations.list) ?? [];

  if (investigations.length === 0) {
    return (
      <p className="text-zinc-600 font-mono text-xs">
        No investigations yet.
      </p>
    );
  }

  return (
    <div className="w-full max-w-2xl">
      <h3 className="text-zinc-500 font-mono text-xs mb-3 tracking-wider">
        RECENT INVESTIGATIONS
      </h3>
      <div className="flex flex-col gap-1">
        {investigations.slice(0, 10).map((inv) => (
          <a
            key={inv._id}
            href={`/investigation/${inv._id}`}
            className="flex items-center justify-between bg-zinc-900 border border-zinc-800 px-4 py-3 hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-center gap-4">
              <StatusDot status={inv.status} />
              <span className="text-zinc-100 font-mono text-sm">
                {inv.drugName || "Untitled"}
                {inv.drugCategory && ` — ${inv.drugCategory}`}
              </span>
            </div>
            <span className="text-zinc-600 font-mono text-xs">
              {new Date(inv.createdAt).toLocaleDateString()}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "pending"
          ? "bg-zinc-500"
          : "bg-amber-500 animate-pulse";

  return <span className={`w-2 h-2 ${color}`} />;
}
