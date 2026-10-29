import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../../common/security/encryption.service';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class GmailService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly logger: AppLoggerService,
  ) {
    this.clientId = this.configService.get<string>('GOOGLE_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET') || '';
    this.redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI') || 'http://localhost:3000/api/integrations/google/callback';
    this.enabled = this.configService.get<boolean>('GMAIL_ENABLED') || false;
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.enabled);
  }

  private getOAuth2Client() {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  generateAuthUrl(ownerId: string): string {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing');
    }

    const oauth2Client = this.getOAuth2Client();
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ];

    const state = this.encryption.encrypt(JSON.stringify({ ownerId, timestamp: Date.now() }));

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state,
    });
  }

  async handleCallback(code: string, state: string): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      const decrypted = JSON.parse(this.encryption.decrypt(state));
      const ownerId = decrypted.ownerId;
      if (!ownerId) {
        return { success: false, error: 'Invalid state parameter' };
      }

      const oauth2Client = this.getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const email = profile.data.emailAddress || 'unknown@gmail.com';

      const encryptedTokens = this.encryption.encrypt(JSON.stringify(tokens));

      await this.prisma.emailAccount.upsert({
        where: {
          ownerId_email: {
            ownerId,
            email,
          },
        },
        update: {
          encryptedTokens,
          status: 'connected',
          updatedAt: new Date(),
        },
        create: {
          ownerId,
          email,
          provider: 'google',
          scopes: tokens.scope || '',
          encryptedTokens,
          status: 'connected',
        },
      });

      this.logger.log(`[GMAIL] Successfully connected account for owner ${ownerId}`);
      return { success: true, email };
    } catch (err: any) {
      this.logger.error(`[GMAIL_CALLBACK_ERROR] ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async getConnectedAccount(ownerId: string) {
    return this.prisma.emailAccount.findFirst({
      where: { ownerId, status: 'connected' },
    });
  }

  async listRecentEmails(ownerId: string, maxResults = 10): Promise<any[]> {
    const account = await this.getConnectedAccount(ownerId);
    if (!account) {
      throw new Error('Chưa có tài khoản Gmail nào được kết nối.');
    }

    const tokens = JSON.parse(this.encryption.decrypt(account.encryptedTokens));
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
    });

    const messages = listRes.data.messages || [];
    const results = [];

    for (const msg of messages) {
      if (!msg.id) continue;
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const subject = headers.find((h) => h.name === 'Subject')?.value || '(Không tiêu đề)';
      const from = headers.find((h) => h.name === 'From')?.value || '';
      const date = headers.find((h) => h.name === 'Date')?.value || '';

      results.push({
        id: msg.id,
        threadId: msg.threadId,
        snippet: detail.data.snippet,
        subject,
        from,
        date,
      });
    }

    return results;
  }

  async createDraft(ownerId: string, to: string, subject: string, bodyText: string): Promise<any> {
    const account = await this.getConnectedAccount(ownerId);
    if (!account) {
      throw new Error('Chưa có tài khoản Gmail nào được kết nối.');
    }

    const tokens = JSON.parse(this.encryption.decrypt(account.encryptedTokens));
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const emailLines = [
      `To: ${to}`,
      `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      bodyText,
    ];
    const raw = Buffer.from(emailLines.join('\r\n')).toString('base64url');

    const draft = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw },
      },
    });

    return {
      draftId: draft.data.id,
      to,
      subject,
      preview: bodyText.slice(0, 100),
    };
  }

  async sendEmail(ownerId: string, to: string, subject: string, bodyText: string): Promise<any> {
    const account = await this.getConnectedAccount(ownerId);
    if (!account) {
      throw new Error('Chưa có tài khoản Gmail nào được kết nối.');
    }

    const tokens = JSON.parse(this.encryption.decrypt(account.encryptedTokens));
    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const emailLines = [
      `To: ${to}`,
      `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      bodyText,
    ];
    const raw = Buffer.from(emailLines.join('\r\n')).toString('base64url');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return {
      messageId: res.data.id,
      threadId: res.data.threadId,
    };
  }
}
