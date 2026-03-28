"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      <TooltipProvider>{children}</TooltipProvider>
    </ConvexAuthNextjsProvider>
  );
}
