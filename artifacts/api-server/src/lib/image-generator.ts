import { logger } from "./logger.js";

/**
 * Generates an illustration for a post using gpt-image-2.
 * The `prompt` should describe what to draw (plain text, no Markdown).
 * Returns a data-URL string (`data:image/png;base64,...`) or throws on failure.
 */
export async function generateIllustration(prompt: string): Promise<string> {
  const apiKey = process.env["PROXYAPI_KEY"];
  if (!apiKey) throw new Error("PROXYAPI_KEY not configured");

  const response = await fetch("https://api.proxyapi.ru/openai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      n: 1,
    }),
  });

  const data = await response.json() as {
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`Image generation API error: ${data.error.message}`);
  }

  const item = data.data?.[0];
  if (!item) throw new Error("No image returned from model");

  const imageUrl = item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : null);
  if (!imageUrl) throw new Error("No image URL or base64 in response");

  logger.info({ promptLength: prompt.length }, "Illustration generated");
  return imageUrl;
}

/**
 * Generates a short image-generation prompt from post content using GPT-4o.
 * Used when no explicit illustration prompt is available (e.g. Автомат mode).
 */
export async function buildIllustrationPrompt(content: string): Promise<string> {
  const apiKey = process.env["PROXYAPI_KEY"];
  if (!apiKey) throw new Error("PROXYAPI_KEY not configured");

  const response = await fetch("https://api.proxyapi.ru/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "Ты генерируешь короткое описание иллюстрации для поста о безопасности. " +
            "Описание должно быть на английском языке, до 200 символов, конкретным и визуально ярким. " +
            "Отвечай только текстом промпта, без пояснений и кавычек.",
        },
        {
          role: "user",
          content: `Вот текст поста:\n\n${content}\n\nОпиши иллюстрацию к нему.`,
        },
      ],
      max_tokens: 100,
      temperature: 0.7,
    }),
  });

  const data = await response.json() as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`GPT error: ${data.error.message}`);
  const prompt = data.choices?.[0]?.message.content.trim() ?? "";
  if (!prompt) throw new Error("Empty prompt from GPT");
  return prompt;
}
