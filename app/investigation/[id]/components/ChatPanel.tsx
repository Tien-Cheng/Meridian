"use client";

import { useEffect, useState, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BotIcon, RadioTowerIcon, SparklesIcon } from "lucide-react";

interface ChatPanelProps {
  investigationContext: {
    drugName?: string;
    protectedMarket?: string;
    regions?: Array<{
      marketplace: string;
      name: string;
    }>;
    sku?: string;
  };
  investigationStatus: string;
  threadId: string;
}

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

const RECOMMENDATION_LIMIT = 4;
const DEFAULT_COMPOSER_HEIGHT = 190;
const MIN_COMPOSER_HEIGHT = 130;
const MAX_COMPOSER_HEIGHT = 360;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadStoredComposerHeight() {
  if (typeof window === "undefined") {
    return DEFAULT_COMPOSER_HEIGHT;
  }

  const storedValue = window.localStorage.getItem("meridian:chatComposerHeight");
  if (!storedValue) {
    return DEFAULT_COMPOSER_HEIGHT;
  }

  const parsedValue = Number(storedValue);
  if (Number.isNaN(parsedValue)) {
    return DEFAULT_COMPOSER_HEIGHT;
  }

  return clamp(parsedValue, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT);
}

function getMessageText(message: UIMessage) {
  if (message.parts.length === 0) {
    return message.text;
  }

  return message.parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function uniqueRecommendations(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildRecommendations({
  investigationContext,
  investigationStatus,
  messages,
}: {
  investigationContext: ChatPanelProps["investigationContext"];
  investigationStatus: string;
  messages: UIMessage[];
}) {
  const productLabel =
    investigationContext.drugName?.trim() ||
    investigationContext.sku?.trim() ||
    "this product";
  const protectedMarket =
    investigationContext.protectedMarket?.trim() ||
    investigationContext.regions?.[0]?.name ||
    "the protected market";
  const marketplaces = uniqueRecommendations(
    (investigationContext.regions ?? []).map((region) => region.marketplace)
  );
  const marketplaceLabel =
    marketplaces.length > 1
      ? `${marketplaces[0]} and ${marketplaces[1]}`
      : marketplaces[0] ?? "the active marketplaces";

  if (messages.length === 0) {
    return [
      `Search ${marketplaceLabel} for suspicious ${productLabel} listings.`,
      `Verify whether any suspicious listings can ship into ${protectedMarket}.`,
      `Trace related seller accounts and storefronts for cross-border patterns.`,
      `Summarize what evidence would make the strongest enforcement case.`,
    ].slice(0, RECOMMENDATION_LIMIT);
  }

  const recentMessages = messages.slice(-6);
  const recentText = recentMessages
    .map(getMessageText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const latestTurn = `${getMessageText(lastUserMessage ?? messages[messages.length - 1])} ${getMessageText(lastAssistantMessage ?? messages[messages.length - 1])}`.toLowerCase();

  const mentionsSearch = includesAny(recentText, [
    /search/,
    /marketplace/,
    /listing/,
    /result/,
    /found/,
  ]);
  const mentionsShipping = includesAny(recentText, [
    /ship/,
    /shipping/,
    /delivery/,
    /eligible/,
    /cross-border/,
  ]);
  const mentionsSeller = includesAny(recentText, [
    /seller/,
    /storefront/,
    /account/,
    /network/,
    /cluster/,
  ]);
  const mentionsRisk = includesAny(recentText, [
    /risk/,
    /counterfeit/,
    /signal/,
    /prescription/,
    /price deviation/,
  ]);
  const mentionsCase = includesAny(recentText, [
    /case/,
    /summary/,
    /brief/,
    /regulator/,
    /enforcement/,
    /evidence pack/,
  ]);
  const mentionsPrice = includesAny(latestTurn, [
    /price/,
    /discount/,
    /underpriced/,
    /deviation/,
    /cheap/,
  ]);

  const recommendations: string[] = [];

  if (!mentionsSearch || includesAny(latestTurn, [/new market/, /another marketplace/])) {
    recommendations.push(
      `Search ${marketplaceLabel} again and flag the most suspicious ${productLabel} listings.`
    );
  }

  if (mentionsSearch && !mentionsShipping) {
    recommendations.push(
      `Verify which flagged listings can still ship into ${protectedMarket}.`
    );
  }

  if (mentionsShipping && !mentionsSeller) {
    recommendations.push(
      "Trace connected seller accounts and storefront overlap for the highest-risk listings."
    );
  }

  if ((mentionsSeller || mentionsRisk) && !mentionsCase) {
    recommendations.push(
      "Summarize the strongest evidence chain for an enforcement-ready case file."
    );
  }

  if (mentionsPrice) {
    recommendations.push(
      `Rank the suspicious listings by price deviation versus the baseline for ${productLabel}.`
    );
  }

  if (mentionsRisk) {
    recommendations.push(
      "List the top counterfeit or compliance risk signals with supporting evidence."
    );
  }

  if (mentionsCase || investigationStatus === "completed") {
    recommendations.push(
      "Draft a concise regulator-facing summary with the strongest findings first."
    );
    recommendations.push(
      "Highlight any evidence gaps or follow-up checks still needed before escalation."
    );
  }

  recommendations.push(
    `Give me the clearest next investigative step for ${productLabel} in ${protectedMarket}.`
  );
  recommendations.push(
    "Summarize the conversation so far in a few actionable bullets."
  );

  return uniqueRecommendations(recommendations).slice(0, RECOMMENDATION_LIMIT);
}

function RecommendationChips({
  disabled,
  onSelect,
  recommendations,
}: {
  disabled: boolean;
  onSelect: (prompt: string) => void;
  recommendations: string[];
}) {
  if (recommendations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <SparklesIcon className="size-3.5 text-amber-400" />
        <span>Suggested next asks</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {recommendations.map((recommendation) => (
          <Button
            className="h-auto rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-left font-mono text-xs text-zinc-300 whitespace-normal hover:border-amber-500/40 hover:bg-zinc-900 hover:text-zinc-100"
            disabled={disabled}
            key={recommendation}
            onClick={() => onSelect(recommendation)}
            size="sm"
            type="button"
            variant="outline"
          >
            {recommendation}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function ChatPanel({
  investigationContext,
  investigationStatus,
  threadId,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(loadStoredComposerHeight);
  const sendMessage = useMutation(api.functions.chat.sendMessage);

  const { results } = useUIMessages(
    api.functions.chat.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true }
  );

  const isStreaming = useMemo(
    () => results.some((message) => message.status === "streaming"),
    [results]
  );
  const recommendations = useMemo(
    () =>
      buildRecommendations({
        investigationContext,
        investigationStatus,
        messages: results,
      }),
    [investigationContext, investigationStatus, results]
  );

  const submitStatus = isSending
    ? "submitted"
    : isStreaming
      ? "streaming"
      : "ready";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      "meridian:chatComposerHeight",
      String(composerHeight)
    );
  }, [composerHeight]);

  const handleSubmit = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || isSending || isStreaming) {
      return;
    }

    setInput("");
    setIsSending(true);
    try {
      await sendMessage({ threadId, prompt });
    } finally {
      setIsSending(false);
    }
  };

  const startComposerResize = (startY: number) => {
    const startHeight = composerHeight;
    document.body.classList.add("cursor-row-resize", "select-none");

    const handleMove = (event: PointerEvent) => {
      const delta = startY - event.clientY;
      const nextHeight = clamp(
        startHeight + delta,
        MIN_COMPOSER_HEIGHT,
        Math.min(MAX_COMPOSER_HEIGHT, window.innerHeight - 240)
      );
      setComposerHeight(nextHeight);
    };

    const handleUp = () => {
      document.body.classList.remove("cursor-row-resize", "select-none");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950 font-mono">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-zinc-500">
              LIVE INVESTIGATION CHAT
            </p>
            <p className="mt-1 text-xs text-zinc-300">
              Narrated findings, tool traces, and enforcement-ready context.
            </p>
          </div>
          <Badge className="border border-zinc-700 bg-zinc-900 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
            {isStreaming ? "Streaming" : "Ready"}
          </Badge>
        </div>
      </div>

      <Conversation>
        <ConversationContent>
          {results.length === 0 ? (
            <ConversationEmptyState
              className="border border-dashed border-zinc-800 bg-zinc-950/70"
              description="Ask Meridian to search live marketplaces, verify shipping risk, or trace connected sellers."
              icon={<BotIcon className="size-5 text-amber-400" />}
              title="No investigation messages yet"
            >
              <div className="flex max-w-md flex-col gap-4">
                <div className="flex flex-col items-center gap-3 text-center">
                  <BotIcon className="size-5 text-amber-400" />
                  <div className="space-y-1">
                    <h3 className="font-medium text-sm text-zinc-100">
                      No investigation messages yet
                    </h3>
                    <p className="text-sm text-zinc-400">
                      Ask Meridian to search live marketplaces, verify shipping
                      risk, or trace connected sellers.
                    </p>
                  </div>
                </div>
                <RecommendationChips
                  disabled={isSending || isStreaming}
                  onSelect={handleSubmit}
                  recommendations={recommendations}
                />
              </div>
            </ConversationEmptyState>
          ) : (
            results.map((msg) => (
              <Message from={msg.role} key={msg.key}>
                {msg.role === "assistant" ? (
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500">
                    <RadioTowerIcon className="size-3.5" />
                    <span>Meridian</span>
                  </div>
                ) : null}
                <MessageContent className="!font-mono">
                  {msg.parts.length > 0 ? (
                    msg.parts.map((part, index) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse
                            className="!font-mono"
                            key={`${msg.key}-text-${index}`}
                          >
                            {part.text}
                          </MessageResponse>
                        );
                      }

                      if (part.type === "reasoning") {
                        return (
                          <div
                            className="border border-zinc-800 bg-zinc-950/70 px-3 py-2 font-mono text-xs text-zinc-400"
                            key={`${msg.key}-reasoning-${index}`}
                          >
                            {part.text}
                          </div>
                        );
                      }

                      if (isToolPart(part)) {
                        return (
                          <Tool
                            defaultOpen={part.state !== "output-available"}
                            key={`${msg.key}-tool-${index}`}
                          >
                            {part.type === "dynamic-tool" ? (
                              <ToolHeader
                                state={part.state}
                                title={part.title}
                                toolName={part.toolName}
                                type={part.type}
                              />
                            ) : (
                              <ToolHeader state={part.state} type={part.type} />
                            )}
                            <ToolContent>
                              <ToolInput input={part.input} />
                              <ToolOutput
                                errorText={part.errorText}
                                output={part.output}
                              />
                            </ToolContent>
                          </Tool>
                        );
                      }

                      if (part.type === "source-url") {
                        return (
                          <div
                            className="border border-zinc-800 bg-zinc-950/70 px-3 py-2 font-mono text-xs text-zinc-400"
                            key={`${msg.key}-source-url-${index}`}
                          >
                            <span className="font-mono uppercase tracking-[0.18em] text-zinc-500">
                              Source
                            </span>
                            <a
                              className="mt-2 block break-all text-amber-400 underline-offset-2 hover:text-amber-300 hover:underline"
                              href={part.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {part.title ?? part.url}
                            </a>
                          </div>
                        );
                      }

                      return null;
                    })
                  ) : (
                    <MessageResponse className="!font-mono">
                      {msg.text}
                    </MessageResponse>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <button
        aria-label="Resize suggestions and composer"
        className="group relative h-2 shrink-0 cursor-row-resize border-t border-b border-zinc-900 bg-zinc-950/80 hover:bg-zinc-900"
        onPointerDown={(event) => {
          event.preventDefault();
          startComposerResize(event.clientY);
        }}
        type="button"
      >
        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-zinc-800 transition-colors group-hover:bg-amber-500" />
      </button>

      <div
        className="shrink-0 overflow-y-auto border-t border-zinc-800 p-3"
        style={{ height: composerHeight }}
      >
        {results.length > 0 ? (
          <div className="mb-3">
            <RecommendationChips
              disabled={isSending || isStreaming}
              onSelect={handleSubmit}
              recommendations={recommendations}
            />
          </div>
        ) : null}
        <PromptInput
          className="border-zinc-800 bg-zinc-900/80 text-zinc-100 shadow-none"
          onSubmit={async ({ text }) => handleSubmit(text)}
        >
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-20 max-h-36 font-mono text-sm text-zinc-100 placeholder:font-mono placeholder:text-zinc-500"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Describe the next investigative step, ask for a seller trace, or request a case summary..."
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter className="border-t border-zinc-800 pt-2">
            <PromptInputTools>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Enter to send
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-700">
                Shift+Enter for newline
              </span>
            </PromptInputTools>
            <PromptInputSubmit
              className="border-amber-500/30 bg-amber-500 text-zinc-950 hover:bg-amber-400"
              disabled={!input.trim() || isSending}
              status={submitStatus}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
