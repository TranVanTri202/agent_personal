import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { AppLoggerService } from '../../common/logger/pino-logger.service';

export interface ImageApiInputReference {
  type: 'image_url';
  image_url: {
    url: string; // e.g. "data:image/jpeg;base64,..."
  };
}

export interface ImageApiRequestPayload {
  model: string;
  prompt: string;
  aspect_ratio?: string;
  resolution?: string;
  n?: number;
  input_references?: ImageApiInputReference[];
}

export interface ImageApiResponseItem {
  b64_json?: string;
  url?: string;
  media_type?: string;
}

export interface ImageApiResponse {
  data: ImageApiResponseItem[];
  costUsd?: number | null;
}

@Injectable()
export class OpenRouterImageClient {
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.baseUrl = (this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1').replace(
      /\/$/,
      '',
    );
  }

  private getApiKey(): string {
    const key = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!key || key.trim().length === 0) {
      throw new Error('OPENROUTER_API_KEY chưa được cấu hình trong file .env');
    }
    return key.trim();
  }

  async callImageApi(payload: ImageApiRequestPayload): Promise<ImageApiResponse> {
    const apiKey = this.getApiKey();
    const endpoint = `${this.baseUrl}/images`;

    // Sanitize payload for logging (never log base64 data)
    const logPayload = {
      model: payload.model,
      prompt: payload.prompt.slice(0, 80),
      aspect_ratio: payload.aspect_ratio,
      resolution: payload.resolution,
      n: payload.n,
      has_input_references: Boolean(payload.input_references?.length),
    };

    this.logger.log(`[OPENROUTER_IMAGE_API] Requesting image generation: ${JSON.stringify(logPayload)}`);

    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PersonalZaloAgent/1.0',
        },
        timeout: 90000, // 90 seconds timeout for image generation
      });

      const responseData = response.data;
      const items: ImageApiResponseItem[] = Array.isArray(responseData?.data) ? responseData.data : [];

      if (items.length === 0) {
        throw new Error('OpenRouter Image API không trả về dữ liệu ảnh trong response (data array rỗng).');
      }

      const costUsd = typeof responseData?.usage?.cost === 'number' ? responseData.usage.cost : null;
      this.logger.log(`[OPENROUTER_IMAGE_API] Success: received ${items.length} image(s). Cost: $${costUsd || 0}`);

      return {
        data: items,
        costUsd,
      };
    } catch (err: any) {
      this.handleApiError(err, payload.model);
      throw err;
    }
  }

  private handleApiError(err: any, model: string): never {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError<any>;
      const status = axiosErr.response?.status;
      const data = axiosErr.response?.data;
      const errorMsg = data?.error?.message || data?.message || axiosErr.message;

      // Sanitized log without auth headers or base64
      this.logger.error(`[OPENROUTER_IMAGE_API_ERROR] Status ${status} on model "${model}": ${errorMsg}`);

      if (status === 401) {
        throw new Error('OpenRouter API Key không hợp lệ hoặc đã hết hạn.');
      }
      if (status === 402) {
        throw new Error(
          'Tài khoản OpenRouter không đủ số dư (Insufficient credits) để tạo ảnh với model này. ' +
            'Vui lòng nạp thêm credits tại https://openrouter.ai/settings/credits.',
        );
      }
      if (status === 404) {
        throw new Error(
          `Model tạo ảnh "${model}" không tồn tại hoặc đã ngừng hỗ trợ trên OpenRouter. Vui lòng kiểm tra lại cấu hình OPENROUTER_IMAGE_MODEL.`,
        );
      }
      if (status === 429) {
        throw new Error('Hệ thống bị giới hạn tốc độ (Rate limited) từ OpenRouter. Vui lòng thử lại sau ít phút.');
      }

      throw new Error(`Lỗi từ OpenRouter Image API (${status}): ${errorMsg}`);
    }

    this.logger.error(`[OPENROUTER_IMAGE_ERROR] Unexpected error: ${err.message}`);
    throw err;
  }
}
