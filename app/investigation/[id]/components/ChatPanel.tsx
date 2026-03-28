"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useUIMessages, SmoothText } from "@convex-dev/agent/react";

interface ChatPanelProps {
  investigationId: Id<"investigations">;
  threadId: string;
}

export default function ChatPanel({
  investigationId,
  threadId,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const sendMessage = useMutation(api.functions.chat.sendMessage);

  const { results, status, loadMore } = useUIMessages(
    api.functions.chat.listMessages,
    { threadId },
    { initialNumItems: 50, stream: true }
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage({ threadId, prompt: text });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {results.length === 0 && (
          <p className="text-zinc-600 font-mono text-xs text-center mt-8">
            Describe your investigation to begin.
          </p>
        )}
        {results.map((msg) => (
          <div
            key={msg.key}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 font-mono text-sm ${
                msg.role === "user"
                  ? "bg-zinc-800 text-zinc-100"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-300"
              }`}
            >
              {msg.role === "assistant" && (
                <span className="text-amber-500 text-xs font-bold block mb-1">
                  MERIDIAN
                </span>
              )}
              {msg.status === "streaming" ? (
                <SmoothText text={msg.text ?? ""} />
              ) : (
                <span className="whitespace-pre-wrap">{msg.text}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex gap-2"
        >
          <input
            className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-100 px-3 py-2 font-mono text-sm placeholder:text-zinc-600 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 outline-none transition-all"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send message..."
          />
          <button
            type="submit"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-mono font-bold px-4 py-2 text-sm transition-colors cursor-pointer"
          >
            &gt;
          </button>
        </form>
      </div>
    </div>
  );
}
