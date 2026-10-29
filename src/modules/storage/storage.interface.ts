export interface PutObjectInput {
  objectKey: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
}

export interface StoredObject {
  objectKey: string;
  sizeBytes: number;
  mimeType: string;
  checksum: string;
  provider: 'LOCAL' | 'R2' | 'SUPABASE';
}

export interface StorageProvider {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  presignDownload?(objectKey: string, expiresInSeconds?: number): Promise<string>;
  isPubliclyAccessible(): boolean;
}
