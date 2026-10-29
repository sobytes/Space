import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOLS, TOOL_BY_NAME } from "@/ai/tools";

/**
 * The AI endpoint.
 *
 * It runs the tool loop server-side against the real engine, which is only possible because
 * `src/engine` imports nothing from the DOM or three.js. The same functions the gates verify
 * answer the model's questions here, so there is no second implementation to drift.
 *
 * Events are streamed as newline-delimited JSON rather than raw text, because the client needs
 * to show which tool ran and what it returned. That visibility is the product: the user should
 * be able to see that a figure came from `run_demonstration` and not from the model.
 */

export const maxDuration = 120;

interface AskRequest {
  readonly messages: { readonly role: "user" | "assistant"; readonly content: string }[];
}

function sse(controller: ReadableStreamDefaultController, event: unknown): void {
  controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "No ANTHROPIC_API_KEY. The simulation works without it; only this panel needs one. " +
          "Add it to .env.local and restart the dev server.",
      },
      { status: 503 },
    );
  }

  let body: AskRequest;
  try {
    body = (await request.json()) as AskRequest;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages must be a non-empty array" }, { status: 400 });
  }

  const client = new Anthropic();
  const conversation: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Bounded, so a model that loops on tool calls cannot run forever on someone's bill.
        for (let turn = 0; turn < 8; turn++) {
          const response = await client.messages.create({
            model: "claude-opus-5",
            max_tokens: 8_000,
            system: SYSTEM_PROMPT,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            tools: TOOLS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.input_schema,
            })) as Anthropic.Tool[],
            messages: conversation,
          });

          for (const block of response.content) {
            if (block.type === "text" && block.text.trim()) {
              sse(controller, { kind: "text", text: block.text });
            }
          }

          if (response.stop_reason === "refusal") {
            sse(controller, { kind: "error", message: "The model declined this request." });
            break;
          }

          const toolUses = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
          );

          if (toolUses.length === 0) break;

          conversation.push({ role: "assistant", content: response.content });

          // All results go back in one user message. Splitting them teaches the model to stop
          // making parallel calls.
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            const tool = TOOL_BY_NAME.get(use.name);
            sse(controller, { kind: "tool", name: use.name, input: use.input });

            if (!tool) {
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                is_error: true,
                content: `no tool called ${use.name}`,
              });
              continue;
            }

            try {
              const output = tool.run((use.input ?? {}) as Record<string, unknown>);
              sse(controller, { kind: "tool_result", name: use.name, output });
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: JSON.stringify(output),
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sse(controller, { kind: "tool_error", name: use.name, message });
              results.push({
                type: "tool_result",
                tool_use_id: use.id,
                is_error: true,
                content: message,
              });
            }
          }

          conversation.push({ role: "user", content: results });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sse(controller, { kind: "error", message });
      } finally {
        sse(controller, { kind: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
