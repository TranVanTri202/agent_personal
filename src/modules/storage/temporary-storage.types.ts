export const TEMP_FILE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours strictly
export const TEMPORARY_FILES_QUEUE_NAME = 'temporary-files-queue';
export const DELETE_TEMPORARY_FILE_JOB = 'delete-temporary-file';

export interface TemporaryFileResult {
  fileId: string;
  bucket: string;
  objectPath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  expiresAt: Date;
  downloadUrl?: string;
}

export interface UploadTemporaryFileInput {
  file: Buffer | Uint8Array | NodeJS.ReadableStream;
  filename: string;
  mimeType: string;
  ownerId?: string;
  conversationId?: string;
  taskId?: string;
}

export interface ActorContext {
  userId?: string;
  isOwner?: boolean;
  chatId?: string;
}

export class FileExpiredError extends Error {
  constructor(message = 'Tệp tin đã hết hạn lưu trữ tạm (24 giờ) và đã được xóa khỏi hệ thống.') {
    super(message);
    this.name = 'FileExpiredError';
  }
}

export class FileAccessDeniedError extends Error {
  constructor(message = 'Bạn không có quyền truy cập hoặc tải tệp tin này.') {
    super(message);
    this.name = 'FileAccessDeniedError';
  }
}
