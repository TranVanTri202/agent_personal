import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

@Injectable()
export class SupabaseStorageClient {
  private client: SupabaseClient | null = null;
  private readonly bucketName: string;
  private readonly supabaseUrl?: string;
  private readonly serviceRoleKey?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    let rawUrl = this.configService.get<string>('SUPABASE_URL')?.trim();
    if (rawUrl) {
      rawUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/storage\/v1\/?$/, '').replace(/\/+$/, '');
    }
    this.supabaseUrl = rawUrl;
    this.serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    this.bucketName = this.configService.get<string>('SUPABASE_STORAGE_BUCKET')?.trim() || 'agent-temp';

    if (this.isConfigured()) {
      try {
        this.client = createClient(this.supabaseUrl!, this.serviceRoleKey!, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        });
        this.logger.log(`[SUPABASE_STORAGE] Initialized client for bucket "${this.bucketName}" at ${this.supabaseUrl}`);
      } catch (err: any) {
        this.logger.error(`[SUPABASE_STORAGE_INIT_ERROR] Failed initializing client: ${err.message}`);
        this.client = null;
      }
    } else {
      this.logger.warn('[SUPABASE_STORAGE] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured. Falling back to local storage.');
    }
  }

  isConfigured(): boolean {
    return Boolean(
      this.supabaseUrl &&
        this.supabaseUrl.startsWith('http') &&
        this.serviceRoleKey &&
        this.serviceRoleKey.length > 10,
    );
  }

  getBucketName(): string {
    return this.bucketName;
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  /**
   * Upload an object to the private bucket using official Supabase Storage API.
   */
  async uploadObject(params: {
    path: string;
    file: Buffer;
    contentType: string;
    upsert?: boolean;
  }): Promise<{ path: string; id?: string }> {
    if (!this.client) {
      throw new Error('Supabase client is not configured.');
    }

    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .upload(params.path, params.file, {
        contentType: params.contentType,
        upsert: params.upsert ?? false,
      });

    if (error) {
      this.logger.error(`[SUPABASE_UPLOAD_ERROR] Path: ${params.path}, Error: ${error.message}`);
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    return {
      path: data.path,
      id: data.id,
    };
  }

  /**
   * Generates a signed download URL with exact TTL in seconds.
   */
  async createSignedUrl(path: string, expiresInSeconds: number, downloadFilename?: string): Promise<string> {
    if (!this.client) {
      throw new Error('Supabase client is not configured.');
    }

    const options: { download?: string | boolean } = {};
    if (downloadFilename) {
      options.download = downloadFilename;
    }

    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .createSignedUrl(path, expiresInSeconds, options);

    if (error || !data?.signedUrl) {
      this.logger.error(`[SUPABASE_SIGNED_URL_ERROR] Path: ${path}, Error: ${error?.message}`);
      throw new Error(`Failed to generate signed URL: ${error?.message || 'Unknown error'}`);
    }

    return data.signedUrl;
  }

  /**
   * Removes objects from the private bucket.
   */
  async removeObjects(paths: string[]): Promise<void> {
    if (!this.client) {
      throw new Error('Supabase client is not configured.');
    }

    if (paths.length === 0) return;

    const { error } = await this.client.storage.from(this.bucketName).remove(paths);
    if (error) {
      this.logger.error(`[SUPABASE_REMOVE_ERROR] Paths: ${paths.join(', ')}, Error: ${error.message}`);
      throw new Error(`Supabase Storage remove failed: ${error.message}`);
    }

    this.logger.log(`[SUPABASE_REMOVED] Successfully removed ${paths.length} object(s) from "${this.bucketName}"`);
  }

  /**
   * Helper to verify or create the private bucket.
   */
  async ensureBucketExists(): Promise<{ success: boolean; created?: boolean; message?: string }> {
    if (!this.client) {
      return { success: false, message: 'Supabase client is not configured.' };
    }

    try {
      const { data: bucket, error } = await this.client.storage.getBucket(this.bucketName);
      if (bucket) {
        return { success: true, created: false, message: `Bucket "${this.bucketName}" exists and is accessible.` };
      }

      if (error && error.message.includes('not found')) {
        const { error: createErr } = await this.client.storage.createBucket(this.bucketName, {
          public: false,
        });
        if (createErr) {
          return {
            success: false,
            message: `Could not create bucket "${this.bucketName}": ${createErr.message}`,
          };
        }
        return { success: true, created: true, message: `Created private bucket "${this.bucketName}" successfully.` };
      }

      return { success: false, message: error?.message };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }
}
