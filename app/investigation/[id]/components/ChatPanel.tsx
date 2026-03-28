"use client";

import { useMemo, useState } from "react";
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
import { BotIcon, RadioTowerIcon } from "lucide-react";

interface ChatPanelProps {
  threadId: string;
}

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

export default function ChatPanel({ threadId }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
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

  const submitStatus = isSending ? "submitted" : isStreaming ? "streaming" : "ready";

  return (
    <div className="flex h-full flex-col bg-zinc-950">
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
            />
          ) : (
            results.map((msg) => (
              <Message from={msg.role} key={msg.key}>
                {msg.role === "assistant" ? (
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500">
                    <RadioTowerIcon className="size-3.5" />
                    <span>Meridian</span>
                  </div>
                ) : null}
                <MessageContent>
                  {msg.parts.length > 0 ? (
                    msg.parts.map((part, index) => {
                      if (part.type === "text") {
                        return (
                          <MessageResponse key={`${msg.key}-text-${index}`}>
                            {part.text}
                          </MessageResponse>
                        );
                      }

                      if (part.type === "reasoning") {
                        return (
                          <div
                            className="border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400"
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
                            className="border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400"
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
                    <MessageResponse>{msg.text}</MessageResponse>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-zinc-800 p-3">
        <PromptInput
          className="border-zinc-800 bg-zinc-900/80 text-zinc-100 shadow-none"
          onSubmit={async ({ text }) => {
            const prompt = text.trim();
            if (!prompt || isSending) {
              return;
            }
            setInput("");
            setIsSending(true);
            try {
              await sendMessage({ threadId, prompt });
            } finally {
              setIsSending(false);
            }
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-20 max-h-36 text-sm text-zinc-100 placeholder:text-zinc-500"
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
