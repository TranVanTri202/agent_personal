import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'zalo-bot-js';
import { IZaloChannel, SendTextOptions } from './zalo-channel.interface';
import { ZALO_BOT_INSTANCE } from './zalo-bot.provider';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class ZaloChannelAdapter implements IZaloChannel {
  private readonly maxMessageLength: number;
  private readonly token: string;

  constructor(
    @Inject(ZALO_BOT_INSTANCE) private readonly bot: Bot,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.token = this.configService.get<string>('ZALO_BOT_TOKEN') || '';
    this.maxMessageLength = this.configService.get<number>('ZALO_MAX_MESSAGE_LENGTH') || 2000;
  }

  hasToken(): boolean {
    return Boolean(this.token && this.token.trim().length > 0);
  }

  getBotInstance(): Bot {
    return this.bot;
  }

  async sendText(chatId: string, text: string, opts?: SendTextOptions): Promise<any[]> {
    const chunks = this.splitMessage(text, this.maxMessageLength);
    const results: any[] = [];

    for (const chunk of chunks) {
      try {
        const res = await this.bot.sendMessage(chatId, chunk, {
          reply_to_message_id: opts?.replyToMessageId,
          parse_mode: opts?.parseMode,
        });
        results.push(res);
      } catch (err: any) {
        this.logSanitizedError('sendMessage', err, { chatId });
        throw err;
      }
    }

    return results;
  }

  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<any> {
    try {
      // NOTE: zalo-bot-js method signature is sendPhoto(chatId, caption, photo, options)
      const res = await this.bot.sendPhoto(chatId, caption || '', photoUrl);
      if (res && typeof res.messageId === 'string' && res.messageId.startsWith('local-') && !res.raw) {
        this.logger.warn(
          `[ZALO_SEND_PHOTO_REJECTED] Zalo API returned ok:false for photoUrl in chat ${chatId}. Check image format/URL.`,
        );
      }
      return res;
    } catch (err: any) {
      this.logSanitizedError('sendPhoto', err, { chatId, photoUrl });
      throw err;
    }
  }

  async sendSticker(chatId: string, stickerId: string): Promise<any> {
    try {
      return await this.bot.sendSticker(chatId, stickerId);
    } catch (err: any) {
      this.logSanitizedError('sendSticker', err, { chatId, stickerId });
      throw err;
    }
  }

  async sendTyping(chatId: string): Promise<any> {
    try {
      return await this.bot.sendChatAction(chatId, 'typing');
    } catch (err: any) {
      this.logSanitizedError('sendTyping', err, { chatId });
      // Non-critical action, don't crash caller
      return false;
    }
  }

  async sendVoice(chatId: string, voiceUrl: string): Promise<any> {
    try {
      return await this.bot.sendVoice(chatId, voiceUrl);
    } catch (err: any) {
      this.logSanitizedError('sendVoice', err, { chatId, voiceUrl });
      throw err;
    }
  }

  async sendFileLink(chatId: string, signedUrl: string, fileName: string): Promise<any> {
    const text = `📎 **${fileName}**\n🔗 [Tải xuống tại đây](${signedUrl})\n\n*(Liên kết có hiệu lực trong thời gian giới hạn)*`;
    return this.sendText(chatId, text);
  }

  // --- Convenience & Backward Compatibility with ZaloApiClient ---

  async sendMessage(chatId: string, text: string, options?: { parse_mode?: any; reply_to_message_id?: string }): Promise<any[]> {
    return this.sendText(chatId, text, {
      parseMode: options?.parse_mode,
      replyToMessageId: options?.reply_to_message_id,
    });
  }

  async sendChatAction(chatId: string, action = 'typing'): Promise<any> {
    try {
      return await this.bot.sendChatAction(chatId, action);
    } catch (err: any) {
      this.logSanitizedError('sendChatAction', err, { chatId, action });
      return false;
    }
  }

  async getMe(): Promise<any> {
    try {
      const user = await this.bot.getMe();
      return {
        ok: true,
        result: {
          id: user.id,
          name: user.displayName || user.accountName,
          username: user.accountName,
          is_bot: user.isBot,
        },
      };
    } catch (err: any) {
      this.logSanitizedError('getMe', err);
      throw err;
    }
  }

  async getWebhookInfo(): Promise<any> {
    try {
      const info = await this.bot.getWebhookInfo();
      return {
        ok: true,
        result: info
          ? {
              url: info.url,
              updated_at: info.updatedAt,
              raw: info.raw,
            }
          : undefined,
      };
    } catch (err: any) {
      this.logSanitizedError('getWebhookInfo', err);
      throw err;
    }
  }

  async setWebhook(webhookUrl: string, secretToken: string): Promise<any> {
    try {
      const result = await this.bot.setWebhook(webhookUrl, secretToken);
      return { ok: true, result };
    } catch (err: any) {
      this.logSanitizedError('setWebhook', err, { webhookUrl });
      throw err;
    }
  }

  async deleteWebhook(): Promise<any> {
    try {
      const result = await this.bot.deleteWebhook();
      return { ok: true, result };
    } catch (err: any) {
      this.logSanitizedError('deleteWebhook', err);
      throw err;
    }
  }

  splitMessage(text: string, limit = 2000): string[] {
    if (!text || text.length <= limit) {
      return [text || ''];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf('\n\n', limit);
      if (splitIndex === -1 || splitIndex < limit / 2) {
        splitIndex = remaining.lastIndexOf('\n', limit);
      }
      if (splitIndex === -1 || splitIndex < limit / 2) {
        splitIndex = remaining.lastIndexOf(' ', limit);
      }
      if (splitIndex === -1 || splitIndex < 1) {
        splitIndex = limit;
        const code = remaining.charCodeAt(splitIndex - 1);
        if (code >= 0xd800 && code <= 0xdbff) {
          splitIndex--;
        }
      }

      const chunk = remaining.slice(0, splitIndex).trim();
      if (chunk) chunks.push(chunk);
      remaining = remaining.slice(splitIndex).trim();
    }

    return chunks;
  }

  private logSanitizedError(method: string, err: any, meta?: Record<string, unknown>) {
    let rawMsg = err instanceof Error ? err.message : String(err);
    if (this.token && this.token.length > 5) {
      rawMsg = rawMsg.split(this.token).join('[REDACTED_TOKEN]');
    }
    // Redact /bot<token> patterns (tokens start with digits:alphanumeric)
    const sanitized = rawMsg.replace(/\/bot([0-9]+:[^/\s]+|[0-9]{10,}[^/\s]*)/g, '/bot[REDACTED_TOKEN]');
    this.logger.error(`[ZALO_SDK_ADAPTER_ERROR] Method "${method}" failed: ${sanitized}`, meta);
  }
}
