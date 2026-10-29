import { Injectable } from '@nestjs/common';
import { ZaloChannelAdapter } from './zalo-channel.adapter';
import { IZaloChannel, SendTextOptions } from './zalo-channel.interface';

export interface ZaloGetMeResponse {
  ok?: boolean;
  result?: {
    id: string;
    name?: string;
    is_bot?: boolean;
    username?: string;
  };
  error_code?: number;
  description?: string;
}

export interface ZaloWebhookInfoResponse {
  ok?: boolean;
  result?: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
  };
}

export interface ZaloApiResponse<T = unknown> {
  ok?: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * ZaloApiClient: Backward-compatible bridge delegating to ZaloChannelAdapter (zalo-bot-js SDK).
 */
@Injectable()
export class ZaloApiClient implements IZaloChannel {
  constructor(private readonly adapter: ZaloChannelAdapter) {}

  hasToken(): boolean {
    return this.adapter.hasToken();
  }

  async getMe(): Promise<ZaloGetMeResponse> {
    return this.adapter.getMe();
  }

  async getWebhookInfo(): Promise<ZaloWebhookInfoResponse> {
    return this.adapter.getWebhookInfo();
  }

  async setWebhook(webhookUrl: string, secretToken: string): Promise<ZaloApiResponse> {
    return this.adapter.setWebhook(webhookUrl, secretToken);
  }

  async deleteWebhook(): Promise<ZaloApiResponse> {
    return this.adapter.deleteWebhook();
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: { parse_mode?: string; reply_to_message_id?: string },
  ): Promise<ZaloApiResponse[]> {
    return this.adapter.sendMessage(chatId, text, options);
  }

  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<ZaloApiResponse> {
    return this.adapter.sendPhoto(chatId, photoUrl, caption);
  }

  async sendVoice(chatId: string, voiceUrl: string): Promise<ZaloApiResponse> {
    return this.adapter.sendVoice(chatId, voiceUrl);
  }

  async sendSticker(chatId: string, stickerId: string): Promise<ZaloApiResponse> {
    return this.adapter.sendSticker(chatId, stickerId);
  }

  async sendChatAction(chatId: string, action = 'typing'): Promise<ZaloApiResponse> {
    const res = await this.adapter.sendChatAction(chatId, action);
    return { ok: Boolean(res), result: res };
  }

  sendText(chatId: string, text: string, opts?: SendTextOptions): Promise<unknown> {
    return this.adapter.sendText(chatId, text, opts);
  }

  sendTyping(chatId: string): Promise<unknown> {
    return this.adapter.sendTyping(chatId);
  }

  sendFileLink(chatId: string, signedUrl: string, fileName: string): Promise<unknown> {
    return this.adapter.sendFileLink(chatId, signedUrl, fileName);
  }

  splitMessage(text: string, limit = 2000): string[] {
    return this.adapter.splitMessage(text, limit);
  }
}
