import { config } from "@/lib/config";

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  chat: {
    id: number;
    type: string;
  };
  from?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const token = config.getTelegramToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${payload}`);
  }
}

export function getMessageText(update: TelegramUpdate): string | null {
  const text = update.message?.text;
  if (!text) {
    return null;
  }
  return text.trim();
}
