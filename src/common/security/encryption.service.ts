import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const rawKey = this.configService.get<string>('ENCRYPTION_KEY') || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    // Ensure key is 32 bytes
    if (rawKey.length === 64) {
      this.key = Buffer.from(rawKey, 'hex');
    } else {
      this.key = crypto.createHash('sha256').update(rawKey).digest();
    }
  }

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(12); // GCM recommended IV 12 bytes
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(cipherText: string): string {
    const [ivHex, authTagHex, encrypted] = cipherText.split(':');
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid cipher text format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  generateRandomCode(length = 6): string {
    const digits = '0123456789';
    let code = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      code += digits[bytes[i] % digits.length];
    }
    return code;
  }

  computeActionDigest(actionType: string, payload: unknown): string {
    const serialized = JSON.stringify({
      actionType,
      payload: this.sortObjectKeys(payload),
    });
    return crypto.createHmac('sha256', this.key).update(serialized).digest('hex');
  }

  private sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }
    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      result[k] = this.sortObjectKeys(record[k]);
    }
    return result;
  }
}
