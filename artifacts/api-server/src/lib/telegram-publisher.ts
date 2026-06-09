import { logger } from "./logger";

const TG_API = "https://api.telegram.org";

export async function publishPostToTelegram(postId: number, content: string, channel = "ya-inzhener"): Promise<number | null> {
  const token = channel === "bezopasnost"
    ? process.env["TELEGRAM_BOT2_TOKEN"]
    : process.env["TELEGRAM_BOT_TOKEN"];
  const channelId = channel === "bezopasnost"
    ? process.env["TELEGRAM_CHANNEL_BEZ_ID"]
    : process.env["TELEGRAM_CHANNEL_ID"];

  if (!token || !channelId) {
    throw new Error(
      channel === "bezopasnost"
        ? "TELEGRAM_BOT2_TOKEN or TELEGRAM_CHANNEL_BEZ_ID not configured"
        : "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not configured",
    );
  }

  const response = await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: channelId,
      text: content,
    }),
  });

  const data = await response.json() as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
    error_code?: number;
  };

  if (!data.ok) {
    throw new Error(`Telegram API error ${data.error_code}: ${data.description}`);
  }

  const messageId = data.result!.message_id;
  logger.info({ postId, messageId, channelId }, "Published to Telegram");
  return messageId;
}
