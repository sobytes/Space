"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The conversational panel.
 *
 * It shows every tool call as it happens, which is deliberate rather than decorative. The whole
 * credibility of the AI layer rests on the model never producing a number, and the only way a
 * user can believe that is to watch the figures arrive from named engine functions. A chat
 * bubble with a confident number in it is indistinguishable from a fabrication; a chat bubble
 * preceded by "describe_body → 29.03 au" is not.
 */

type Entry =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly input: unknown }
  | { readonly kind: "tool_result"; readonly name: string }
  | { readonly kind: "tool_error"; readonly name: string; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/** What the route can emit. "done" closes the stream and is not displayed. */
type StreamEvent = Entry | { readonly kind: "done" };

const SUGGESTIONS = [
  "Why doesn't Mercury's orbit close?",
  "How far does Jupiter move the Sun?",
  "Compare Saturn and Jupiter",
  "Prove Kepler's third law",
];

export function AskPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const send = useCallback(
    async (question: string) => {
      if (!question.trim() || busy) return;
      setInput("");
      setBusy(true);

      const history = entries
        .filter((e): e is Extract<Entry, { kind: "user" | "text" }> =>
          e.kind === "user" || e.kind === "text",
        )
        .map((e) => ({ role: e.kind === "user" ? ("user" as const) : ("assistant" as const), content: e.text }));

      setEntries((previous) => [...previous, { kind: "user", text: question }]);

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...history, { role: "user", content: question }] }),
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => ({ error: response.statusText }));
          setEntries((p) => [...p, { kind: "error", message: String(detail.error ?? "request failed") }]);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newline = buffer.indexOf("\n");
          while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line) continue;

            const event = JSON.parse(line) as StreamEvent;
            if (event.kind === "done") continue;
            setEntries((p) => [...p, event]);
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
          }
        }
      } catch (error) {
        setEntries((p) => [
          ...p,
          { kind: "error", message: error instanceof Error ? error.message : String(error) },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, entries],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute bottom-24 right-4 rounded-xl border border-sky-400/30 bg-black/70 px-3.5 py-2 text-xs font-medium text-sky-300 backdrop-blur-md transition hover:bg-sky-400/10"
      >
        Ask about the solar system
      </button>
    );
  }

  return (
    <aside className="pointer-events-auto absolute bottom-24 right-4 flex h-[28rem] w-[26rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-white/10 bg-black/85 backdrop-blur-md">
      <header className="flex items-start justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-50">Ask</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Every figure comes from a named engine function, shown as it runs
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-0.5 text-xs text-zinc-400 transition hover:bg-white/10"
        >
          Close
        </button>
      </header>

      <div ref={scroller} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <div className="space-y-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="block w-full rounded-md border border-white/10 px-2.5 py-1.5 text-left text-[12px] text-zinc-300 transition hover:bg-white/10"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {entries.map((entry, index) => {
          if (entry.kind === "user") {
            return (
              <p key={index} className="ml-8 rounded-lg bg-sky-500/15 px-3 py-2 text-[12px] text-sky-50">
                {entry.text}
              </p>
            );
          }
          if (entry.kind === "text") {
            return (
              <p key={index} className="whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-200">
                {entry.text}
              </p>
            );
          }
          if (entry.kind === "tool") {
            return (
              <p key={index} className="font-mono text-[10px] text-emerald-400/80">
                → {entry.name}({JSON.stringify(entry.input).slice(0, 90)})
              </p>
            );
          }
          if (entry.kind === "tool_result") {
            return (
              <p key={index} className="font-mono text-[10px] text-emerald-400/50">
                ← {entry.name} returned
              </p>
            );
          }
          if (entry.kind === "tool_error") {
            return (
              <p key={index} className="font-mono text-[10px] text-amber-400/80">
                ! {entry.name}: {entry.message}
              </p>
            );
          }
          return (
            <p key={index} className="text-[11px] leading-relaxed text-red-400">
              {entry.message}
            </p>
          );
        })}

        {busy ? <p className="text-[11px] text-zinc-500">thinking…</p> : null}
      </div>

      <form
        className="flex gap-2 border-t border-white/10 px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask anything about the solar system"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-[12px] text-zinc-100 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-sky-400 px-3 py-1.5 text-[12px] font-medium text-black transition hover:bg-sky-300 disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </aside>
  );
}
