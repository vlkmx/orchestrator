import OpenAI from "openai";
import { z } from "zod";

export interface JsonCallParams<TSchema extends z.ZodTypeAny> {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  userPayload: Record<string, unknown>;
  schema: TSchema;
  maxRetries: number;
}

export interface JsonCallResult<T> {
  parsed: T;
  rawText: string;
}

function extractMessageText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  const message = response.choices[0]?.message?.content;
  if (!message) {
    return "";
  }

  if (typeof message === "string") {
    return message;
  }

  return "";
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

export async function callModelForJson<TSchema extends z.ZodTypeAny>(
  params: JsonCallParams<TSchema>
): Promise<JsonCallResult<z.infer<TSchema>>> {
  const { client, model, systemPrompt, userPayload, schema, maxRetries } = params;

  let lastRawText = "";
  let lastError = "No attempts made.";
  let repairHint = "";

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const payload = {
      attempt,
      schemaReminder: "Return valid JSON only. No markdown.",
      repairHint,
      data: userPayload
    };

    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) }
      ]
    });

    lastRawText = extractMessageText(completion);

    try {
      const candidate = extractJsonCandidate(lastRawText);
      const parsedJson = JSON.parse(candidate) as unknown;
      const validated = schema.parse(parsedJson);
      return {
        parsed: validated,
        rawText: lastRawText
      };
    } catch (error) {
      const err = error as Error;
      lastError = err.message;
      repairHint = `Previous output was invalid. Error: ${err.message}. Return strict JSON matching schema.`;
    }
  }

  throw new Error(`Model JSON parse failed after ${maxRetries} attempts. Last error: ${lastError}. Last raw: ${lastRawText}`);
}
