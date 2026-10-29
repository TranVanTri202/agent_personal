export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string,
    public readonly isRetryable: boolean = false,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class OpenRouterCapabilityError extends Error {
  constructor(
    public readonly modelId: string,
    public readonly missingCapability: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouterCapabilityError';
  }
}

export class OpenRouterBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterBudgetError';
  }
}

export function mapOpenRouterError(err: any): Error {
  if (err instanceof OpenRouterCapabilityError || err instanceof OpenRouterBudgetError) {
    return err;
  }

  const status = err.status || err.response?.status || err.statusCode || 500;
  const data = err.response?.data || err.error || {};
  const errorMessage = data.error?.message || err.message || 'Unknown OpenRouter error';
  const errorCode = data.error?.code || 'openrouter_error';

  switch (status) {
    case 401:
      return new OpenRouterError(
        'OpenRouter API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra OPENROUTER_API_KEY trong .env',
        401,
        'invalid_api_key',
        false,
      );

    case 402:
      return new OpenRouterError(
        'Tài khoản OpenRouter không đủ số dư credits (Insufficient Credits / 402). Vui lòng nạp thêm credits tại https://openrouter.ai/credits',
        402,
        'insufficient_credits',
        false,
      );

    case 403:
      return new OpenRouterError(
        `Quyền truy cập bị từ chối trên OpenRouter (403): ${errorMessage}`,
        403,
        'forbidden',
        false,
      );

    case 404:
      return new OpenRouterError(
        `Không tìm thấy model hoặc endpoint trên OpenRouter (404): ${errorMessage}`,
        404,
        'model_not_found',
        false,
      );

    case 429:
      return new OpenRouterError(
        `Vượt quá giới hạn tốc độ (Rate Limit / 429) trên OpenRouter. Vui lòng thử lại sau giây lát: ${errorMessage}`,
        429,
        'rate_limit_exceeded',
        true,
      );

    case 500:
    case 502:
    case 503:
    case 504:
      return new OpenRouterError(
        `Nhà cung cấp model hoặc OpenRouter gặp lỗi máy chủ (${status}): ${errorMessage}`,
        status,
        'provider_error',
        true,
      );

    default:
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        return new OpenRouterError('Yêu cầu tới OpenRouter đã hết thời gian chờ (Timeout).', 408, 'timeout', true);
      }
      return new OpenRouterError(errorMessage, status, errorCode, false);
  }
}
