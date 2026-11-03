import { Injectable } from '@nestjs/common';
import { Message } from 'zalo-bot-js';

export interface NormalizedIncomingMessage {
  channel: 'ZALO_OFFICIAL_BOT';
  externalMessageId: string;
  externalUpdateId?: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  chatType: 'PRIVATE' | 'GROUP';
  type: 'TEXT' | 'IMAGE' | 'VOICE' | 'FILE' | 'STICKER' | 'UNSUPPORTED';
  text?: string;
  caption?: string;
  stickerId?: string;
  imageUrl?: string;
  voiceUrl?: string;
  fileUrl?: string;
  fileName?: string;
  replyToMessageId?: string;
  attachments: Array<{ type: 'IMAGE' | 'VOICE' | 'FILE' | 'OTHER'; sourceUrl?: string; fileName?: string }>;
  sentAt: Date;
  rawEvent: unknown;
}

@Injectable()
export class ZaloEventNormalizer {
  /**
   * Normalizes incoming message from SDK (Message + metadata) or legacy raw API payload.
   */
  normalize(raw: any, metadata?: any): NormalizedIncomingMessage | null {
    if (!raw) return null;

    // Check if raw is an instance of SDK Message or has SDK Message properties
    if (raw instanceof Message || (raw.messageId && raw.chat && typeof raw.chat === 'object')) {
      return this.normalizeSdkMessage(raw, metadata);
    }

    // Otherwise, normalize from raw API payload
    return this.normalizeRawPayload(raw);
  }

  normalizeSdkMessage(msg: Message | any, metadata?: any): NormalizedIncomingMessage | null {
    const externalMessageId =
      msg.messageId || `zalo-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const externalUpdateId = metadata?.update?.updateId !== undefined ? String(metadata.update.updateId) : undefined;

    const senderId = String(msg.fromUser?.id || msg.chat?.id || '');
    const senderName = msg.fromUser?.name || msg.fromUser?.displayName;
    const chatId = String(msg.chat?.id || senderId);
    const chatType = msg.chat?.type === 'GROUP' ? 'GROUP' : 'PRIVATE';
    const sentAt = msg.date instanceof Date ? msg.date : new Date();

    let type: NormalizedIncomingMessage['type'] = 'UNSUPPORTED';
    let text: string | undefined = undefined;
    let caption: string | undefined = undefined;
    let stickerId: string | undefined = undefined;
    let imageUrl: string | undefined = undefined;
    let voiceUrl: string | undefined = undefined;
    let fileUrl: string | undefined = undefined;
    let fileName: string | undefined = undefined;
    const attachments: NormalizedIncomingMessage['attachments'] = [];

    // Extract sticker if present
    const rawSticker = msg.sticker || msg.raw?.sticker || msg.raw?.sticker_id || msg.raw?.message?.sticker;
    if (rawSticker) {
      type = 'STICKER';
      stickerId = String(rawSticker);
      text = `[Sticker: ${stickerId}]`;
    } else if (msg.photoUrl || msg.raw?.photo_url || msg.raw?.photo) {
      type = 'IMAGE';
      imageUrl = msg.photoUrl || msg.raw?.photo_url || msg.raw?.photo;
      caption = msg.caption || msg.text;
      attachments.push({ type: 'IMAGE', sourceUrl: imageUrl });
    } else if (msg.voiceUrl || msg.raw?.voice_url) {
      type = 'VOICE';
      voiceUrl = msg.voiceUrl || msg.raw?.voice_url;
      attachments.push({ type: 'VOICE', sourceUrl: voiceUrl });
    } else if (msg.fileUrl || msg.raw?.file_url || msg.raw?.document?.url) {
      type = 'FILE';
      fileUrl = msg.fileUrl || msg.raw?.file_url || msg.raw?.document?.url;
      fileName = msg.fileName || msg.raw?.file_name || msg.raw?.document?.file_name || 'uploaded-file';
      caption = msg.caption || msg.text;
      attachments.push({ type: 'FILE', sourceUrl: fileUrl, fileName });
    } else if (msg.text) {
      type = 'TEXT';
      text = msg.text;
    } else {
      type = 'UNSUPPORTED';
      text = '[Unsupported message format]';
    }

    if (!senderId || !chatId) {
      return null;
    }

    const replyToMessageId =
      msg.replyToMessage?.id ||
      msg.raw?.reply_to_message?.message_id ||
      msg.quote?.msg_id ||
      msg.raw?.quote?.msg_id ||
      metadata?.replyToMessageId ||
      undefined;

    return {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId,
      externalUpdateId,
      senderId,
      senderName,
      chatId,
      chatType,
      type,
      text,
      caption,
      stickerId,
      imageUrl,
      voiceUrl,
      fileUrl,
      fileName,
      replyToMessageId,
      attachments,
      sentAt,
      rawEvent: msg.raw || msg,
    };
  }

  private normalizeRawPayload(raw: any): NormalizedIncomingMessage | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const eventName: string = raw.event_name || raw.event || '';
    const message = raw.message || raw;

    if (!message || typeof message !== 'object') {
      return null;
    }

    const externalMessageId: string =
      message.message_id ||
      message.msg_id ||
      raw.message_id ||
      `zalo-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const from = message.from || raw.from || {};
    const senderId: string = String(from.id || message.user_id || message.sender_id || raw.sender_id || '');
    const senderName: string | undefined = from.display_name || from.name || undefined;

    const chat = message.chat || raw.chat || {};
    const chatId: string = String(chat.id || message.chat_id || senderId);
    const chatType: 'PRIVATE' | 'GROUP' =
      chat.chat_type === 'GROUP' || message.chat_type === 'GROUP' ? 'GROUP' : 'PRIVATE';

    const rawDate = message.date || message.timestamp || Date.now();
    const sentAt = new Date(typeof rawDate === 'number' ? rawDate : Date.now());

    let type: NormalizedIncomingMessage['type'] = 'UNSUPPORTED';
    let text: string | undefined = undefined;
    let caption: string | undefined = undefined;
    let stickerId: string | undefined = undefined;
    let imageUrl: string | undefined = undefined;
    let voiceUrl: string | undefined = undefined;
    let fileUrl: string | undefined = undefined;
    let fileName: string | undefined = undefined;
    const attachments: NormalizedIncomingMessage['attachments'] = [];

    if (eventName === 'message.text.received' || (!eventName && message.text && !message.sticker && !message.photo_url && !message.file_url)) {
      type = 'TEXT';
      text = message.text || '';
    } else if (eventName === 'message.image.received' || message.photo_url || message.photo) {
      type = 'IMAGE';
      imageUrl = message.photo_url || message.url || message.photo;
      caption = message.caption || message.text || undefined;
      attachments.push({ type: 'IMAGE', sourceUrl: imageUrl });
    } else if (eventName === 'message.voice.received' || message.voice_url) {
      type = 'VOICE';
      voiceUrl = message.voice_url || message.url;
      attachments.push({ type: 'VOICE', sourceUrl: voiceUrl });
    } else if (eventName === 'message.file.received' || message.file_url || message.document) {
      type = 'FILE';
      fileUrl = message.file_url || message.document?.url || message.url;
      fileName = message.file_name || message.document?.file_name || 'uploaded-file';
      caption = message.caption || message.text || undefined;
      attachments.push({ type: 'FILE', sourceUrl: fileUrl, fileName });
    } else if (eventName === 'message.sticker.received' || message.sticker || message.sticker_id) {
      type = 'STICKER';
      stickerId = String(message.sticker || message.sticker_id || message.url);
      text = `[Sticker: ${stickerId}]`;
    } else {
      type = 'UNSUPPORTED';
      text = message.text || '[Unsupported message format]';
    }

    if (!senderId || !chatId) {
      return null;
    }

    const replyToMessageId =
      message.reply_to_message_id ||
      message.quote?.msg_id ||
      raw.reply_to_message_id ||
      undefined;

    return {
      channel: 'ZALO_OFFICIAL_BOT',
      externalMessageId,
      senderId,
      senderName,
      chatId,
      chatType,
      type,
      text,
      caption,
      stickerId,
      imageUrl,
      voiceUrl,
      fileUrl,
      fileName,
      replyToMessageId,
      attachments,
      sentAt,
      rawEvent: raw,
    };
  }
}
