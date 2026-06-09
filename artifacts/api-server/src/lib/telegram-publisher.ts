import { logger } from "./logger";

const TG_API = "https://api.telegram.org";
const TG_CAPTION_LIMIT = 1024;

export async function publishPostToTelegram(
  postId: number,
  content: string,
  channel = "ya-inzhener",
  illustrationUrl?: string | null,
): Promise<number | null> {
  const token =
    channel === "bezopasnost"
      ? process.env["TELEGRAM_BOT2_TOKEN"]
      : process.env["TELEGRAM_BOT_TOKEN"];
  const channelId =
    channel === "bezopasnost"
      ? process.env["TELEGRAM_CHANNEL_BEZ_ID"]
      : process.env["TELEGRAM_CHANNEL_ID"];

  if (!token || !channelId) {
    throw new Error(
      channel === "bezopasnost"
        ? "TELEGRAM_BOT2_TOKEN or TELEGRAM_CHANNEL_BEZ_ID not configured"
        : "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not configured",
    );
  }

  async function tgFetch(method: string, body: string | FormData, isJson = true) {
    const headers = isJson ? { "Content-Type": "application/json" } : undefined;
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers,
      body,
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: { message_id: number };
      description?: string;
      error_code?: number;
    };
    if (!data.ok) {
      throw new Error(`Telegram API error ${data.error_code}: ${data.description}`);
    }
    return data.result!.message_id;
  }

  if (illustrationUrl) {
    const base64Data = illustrationUrl.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    if (content.length <= TG_CAPTION_LIMIT) {
      // Фото + текст в подписи (один пост)
      const form = new FormData();
      form.append("chat_id", channelId);
      form.append("caption", content);
      form.append(
        "photo",
        new Blob([imageBuffer], { type: "image/png" }),
        "illustration.png",
      );
      const messageId = await tgFetch("sendPhoto", form, false);
      logger.info({ postId, messageId, channelId }, "Published photo+caption to Telegram");
      return messageId;
    } else {
      // Фото отдельно, потом текст (контент длиннее 1024 символов)
      const form = new FormData();
      form.append("chat_id", channelId);
      form.append(
        "photo",
        new Blob([imageBuffer], { type: "image/png" }),
        "illustration.png",
      );
      await tgFetch("sendPhoto", form, false);

      const messageId = await tgFetch(
        "sendMessage",
        JSON.stringify({ chat_id: channelId, text: content }),
      );
      logger.info({ postId, messageId, channelId }, "Published photo + text to Telegram");
      return messageId;
    }
  }

  // Без картинки — просто текст
  const messageId = await tgFetch(
    "sendMessage",
    JSON.stringify({ chat_id: channelId, text: content }),
  );
  logger.info({ postId, messageId, channelId }, "Published text to Telegram");
  return messageId;
}
