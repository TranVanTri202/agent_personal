import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    const isDev = process.env.NODE_ENV !== 'production';
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      redact: {
        paths: [
          'req.headers.authorization',
          '*.headers.authorization',
          '*.password',
          '*.token',
          '*.secret',
          '*.encryptedTokens',
          '*.code',
          '*.ZALO_BOT_TOKEN',
          '*.OPENAI_API_KEY',
          '*.R2_SECRET_ACCESS_KEY',
          '*.GOOGLE_CLIENT_SECRET',
        ],
        censor: '[REDACTED_SECRET]',
      },
    });
  }

  private sanitize(message: unknown): unknown {
    if (typeof message === 'string') {
      // Redact Zalo bot tokens in URLs: /bot<TOKEN>/...
      let sanitized = message.replace(/\/bot([^/]+)\//g, '/bot[REDACTED_TOKEN]/');
      // Redact bearer tokens
      sanitized = sanitized.replace(/Bearer\s+([A-Za-z0-9._-]+)/gi, 'Bearer [REDACTED]');
      return sanitized;
    }
    return message;
  }

  log(message: any, ...optionalParams: any[]) {
    const sanitized = this.sanitize(message);
    if (typeof sanitized === 'string') {
      this.logger.info(sanitized);
    } else {
      this.logger.info({ data: sanitized });
    }
  }

  error(message: any, ...optionalParams: any[]) {
    const sanitized = this.sanitize(message);
    if (typeof sanitized === 'string') {
      this.logger.error(sanitized);
    } else {
      this.logger.error({ data: sanitized });
    }
  }

  warn(message: any, ...optionalParams: any[]) {
    const sanitized = this.sanitize(message);
    if (typeof sanitized === 'string') {
      this.logger.warn(sanitized);
    } else {
      this.logger.warn({ data: sanitized });
    }
  }

  debug?(message: any, ...optionalParams: any[]) {
    const sanitized = this.sanitize(message);
    if (typeof sanitized === 'string') {
      this.logger.debug(sanitized);
    } else {
      this.logger.debug({ data: sanitized });
    }
  }

  verbose?(message: any, ...optionalParams: any[]) {
    const sanitized = this.sanitize(message);
    if (typeof sanitized === 'string') {
      this.logger.trace(sanitized);
    } else {
      this.logger.trace({ data: sanitized });
    }
  }
}
