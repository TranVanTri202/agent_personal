export interface SendTextOptions {
  replyToMessageId?: string;
  parseMode?: 'markdown' | 'html';
}

export interface IZaloChannel {
  sendText(chatId: string, text: string, opts?: SendTextOptions): Promise<unknown>;
  sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<unknown>;
  sendSticker(chatId: string, stickerId: string): Promise<unknown>;
  sendTyping(chatId: string): Promise<unknown>;
  sendVoice(chatId: string, voiceUrl: string): Promise<unknown>;
  sendFileLink(chatId: string, signedUrl: string, fileName: string): Promise<unknown>;
}

export const ZALO_CHANNEL_TOKEN = 'IZaloChannel';
