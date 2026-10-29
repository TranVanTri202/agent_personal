import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import { StorageProvider, PutObjectInput, StoredObject } from './storage.interface';
import { Readable } from 'stream';

@Injectable()
export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client | null = null;
  private readonly bucket: string;
  private readonly ttlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket = this.configService.get<string>('R2_BUCKET') || '';
    this.ttlSeconds = this.configService.get<number>('FILE_SIGNED_URL_TTL_SECONDS') || 900;

    if (accountId && accessKeyId && secretAccessKey && this.bucket) {
      const endpoint =
        this.configService.get<string>('R2_ENDPOINT') ||
        `https://${accountId}.r2.cloudflarestorage.com`;

      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  isConfigured(): boolean {
    return this.client !== null && Boolean(this.bucket);
  }

  isPubliclyAccessible(): boolean {
    return this.isConfigured();
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    if (!this.client) {
      throw new Error('Cloudflare R2 storage is not configured');
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );

    const checksum = crypto.createHash('sha256').update(input.buffer).digest('hex');

    return {
      objectKey: input.objectKey,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      checksum,
      provider: 'R2',
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    if (!this.client) {
      throw new Error('Cloudflare R2 storage is not configured');
    }

    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );

    if (!res.Body) {
      throw new Error(`File not found in R2: ${objectKey}`);
    }

    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(objectKey: string): Promise<void> {
    if (!this.client) return;

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );
  }

  async presignDownload(objectKey: string, expiresInSeconds = this.ttlSeconds): Promise<string> {
    if (!this.client) {
      throw new Error('Cloudflare R2 storage is not configured');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
