import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AppLoggerService } from '../../common/logger/pino-logger.service';
import { ImageModelInfo } from './dto/image-generation.dto';

@Injectable()
export class ImageCapabilityService {
  private modelsCache: ImageModelInfo[] | null = null;
  private lastFetchTime = 0;
  private readonly cacheTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  private getApiKey(): string | undefined {
    return this.configService.get<string>('OPENROUTER_API_KEY');
  }

  async getImageModels(forceRefresh = false): Promise<ImageModelInfo[]> {
    const now = Date.now();
    if (!forceRefresh && this.modelsCache && now - this.lastFetchTime < this.cacheTtlMs) {
      return this.modelsCache;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('[IMAGE_CAPABILITY] OPENROUTER_API_KEY is not set. Cannot fetch image models.');
      return this.modelsCache || [];
    }

    try {
      const res = await axios.get('https://openrouter.ai/api/v1/images/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'PersonalZaloAgent/1.0',
        },
        timeout: 10000,
      });

      const rawModels = res.data?.data || [];
      this.modelsCache = rawModels.map((m: any) => {
        const supportedParams = m.supported_parameters || {};
        const inputRefs = supportedParams.input_references;
        return {
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          supportedParameters: supportedParams,
          supportsInputReferences: Boolean(inputRefs),
          maxInputReferences: typeof inputRefs?.max === 'number' ? inputRefs.max : 0,
        };
      });

      this.lastFetchTime = now;
      this.logger.log(`[IMAGE_CAPABILITY] Successfully cached ${this.modelsCache?.length || 0} OpenRouter image models.`);
      return this.modelsCache || [];
    } catch (err: any) {
      this.logger.warn(`[IMAGE_CAPABILITY] Failed to fetch image models from OpenRouter: ${err.message}`);
      return this.modelsCache || [];
    }
  }

  async getModelInfo(modelId: string): Promise<ImageModelInfo | null> {
    const models = await this.getImageModels();
    return models.find((m) => m.id.toLowerCase() === modelId.toLowerCase()) || null;
  }

  async supportsInputReferences(modelId: string): Promise<boolean> {
    const info = await this.getModelInfo(modelId);
    return Boolean(info?.supportsInputReferences);
  }

  async validateAndSanitizeParams(
    modelId: string,
    params: { aspectRatio?: string; resolution?: string; count?: number; hasReference?: boolean },
  ): Promise<{ sanitized: Record<string, any>; warning?: string }> {
    const info = await this.getModelInfo(modelId);
    const sanitized: Record<string, any> = {};
    const warnings: string[] = [];

    if (!info) {
      // Model not found in cache or catalog, pass params through safely
      if (params.aspectRatio) sanitized.aspect_ratio = params.aspectRatio;
      if (params.resolution) sanitized.resolution = params.resolution;
      if (params.count && params.count > 1) sanitized.n = Math.min(params.count, 4);
      return { sanitized };
    }

    // 1. Check input_references if hasReference
    if (params.hasReference && !info.supportsInputReferences) {
      throw new Error(
        `Model "${modelId}" không hỗ trợ chỉnh sửa ảnh bằng ảnh mẫu (input_references). ` +
          `Vui lòng chọn model có hỗ trợ edit ảnh như "qwen/qwen-image-2.1-turbo", "google/gemini-2.5-flash-image", hoặc "black-forest-labs/flux-3-image".`,
      );
    }

    const supported = info.supportedParameters;

    // 2. Aspect Ratio
    if (params.aspectRatio) {
      const arConfig = supported.aspect_ratio;
      if (arConfig && Array.isArray(arConfig.values)) {
        if (arConfig.values.includes(params.aspectRatio)) {
          sanitized.aspect_ratio = params.aspectRatio;
        } else {
          warnings.push(`Tỷ lệ ${params.aspectRatio} không nằm trong danh sách hỗ trợ của model (${arConfig.values.join(', ')}). Đã bỏ qua.`);
        }
      } else if (arConfig) {
        sanitized.aspect_ratio = params.aspectRatio;
      }
    }

    // 3. Resolution
    if (params.resolution) {
      const resConfig = supported.resolution;
      if (resConfig && Array.isArray(resConfig.values)) {
        if (resConfig.values.includes(params.resolution)) {
          sanitized.resolution = params.resolution;
        } else {
          warnings.push(`Độ phân giải ${params.resolution} không được hỗ trợ (${resConfig.values.join(', ')}).`);
        }
      } else if (resConfig) {
        sanitized.resolution = params.resolution;
      }
    }

    // 4. Count (n)
    if (params.count && params.count > 1) {
      const nConfig = supported.n;
      if (nConfig) {
        const maxN = typeof nConfig.max === 'number' ? nConfig.max : 4;
        sanitized.n = Math.min(params.count, maxN);
      } else {
        warnings.push(`Model "${modelId}" chỉ hỗ trợ tạo 1 ảnh mỗi lần gọi.`);
      }
    }

    return {
      sanitized,
      warning: warnings.length > 0 ? warnings.join('\n') : undefined,
    };
  }
}
