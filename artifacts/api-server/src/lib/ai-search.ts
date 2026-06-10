import { logger } from "./logger.js";

export interface WebSearchResult {
  content: string;
  urls: string[];
}

/**
 * Calls gpt-4o-search-preview with web search enabled.
 * Returns the model's text response and all URL annotations found.
 * On error falls back gracefully with empty urls array.
 */
export async function callWithWebSearch(
  systemPrompt: string,
  userMessage: string,
): Promise<WebSearchResult> {
  const apiKey = process.env["PROXYAPI_KEY"] ?? "missing";

  const response = await fetch("https://api.proxyapi.ru/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-search-preview",
      web_search_options: {
        search_context_size: "medium",
        user_location: {
          type: "approximate",
          approximate: { country: "RU" },
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content: string;
        annotations?: Array<{
          type: string;
          url_citation?: { url: string; title: string };
        }>;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) {
    logger.warn({ error: data.error }, "gpt-4o-search-preview error");
    return { content: "", urls: [] };
  }

  const message = data.choices[0]?.message;
  const content = message?.content ?? "";
  const urls = (message?.annotations ?? [])
    .filter((a) => a.type === "url_citation" && a.url_citation)
    .map((a) => a.url_citation!.url)
    .filter((url, i, arr) => arr.indexOf(url) === i);

  logger.info({ foundUrls: urls }, "Web search completed");

  return { content, urls };
}
