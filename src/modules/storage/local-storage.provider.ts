import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StorageProvider, PutObjectInput, StoredObject } from './storage.interface';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly rootDir: string;

  constructor(private readonly configService: ConfigService) {
    this.rootDir = path.resolve(this.configService.get<string>('LOCAL_STORAGE_ROOT') || './data');
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  isPubliclyAccessible(): boolean {
    return false;
  }

  private getSafePath(objectKey: string): string {
    const normalized = path.normalize(objectKey).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(this.rootDir, normalized);
    if (!fullPath.startsWith(this.rootDir)) {
      throw new Error(`Path traversal attempt detected: ${objectKey}`);
    }
    return fullPath;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const fullPath = this.getSafePath(input.objectKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, input.buffer);
    const checksum = crypto.createHash('sha256').update(input.buffer).digest('hex');

    return {
      objectKey: input.objectKey,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      checksum,
      provider: 'LOCAL',
    };
  }

  async get(objectKey: string): Promise<Buffer> {
    const fullPath = this.getSafePath(objectKey);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${objectKey}`);
    }
    return fs.promises.readFile(fullPath);
  }

  async delete(objectKey: string): Promise<void> {
    const fullPath = this.getSafePath(objectKey);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }
}
