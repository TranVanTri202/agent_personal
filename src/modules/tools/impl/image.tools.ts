import { Injectable } from '@nestjs/common';
import { AgentTool, ToolExecutionContext } from '../tool.interface';
import { ImageGenerationService } from '../../image-generation/image-generation.service';
import { GenerateImageDto, EditImageDto } from '../../image-generation/dto/image-generation.dto';

@Injectable()
export class GenerateImageTool implements AgentTool<GenerateImageDto> {
  name = 'generate_image';
  description =
    'Tạo ảnh mới từ mô tả văn bản (text-to-image) bằng OpenRouter Image API. Hỗ trợ tỷ lệ (aspectRatio: 1:1, 16:9, 9:16), độ phân giải, phong cách (style: chibi, anime, realistic...). Kết quả tự động gửi về Zalo chat.';
  riskLevel: 'MEDIUM' = 'MEDIUM';
  inputSchema = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Mô tả chi tiết nội dung ảnh muốn tạo (bằng tiếng Việt hoặc tiếng Anh).',
      },
      aspectRatio: {
        type: 'string',
        description: 'Tỷ lệ khung hình mong muốn (ví dụ: "1:1", "16:9", "9:16", "4:3", "3:4").',
      },
      resolution: {
        type: 'string',
        description: 'Độ phân giải mong muốn (ví dụ: "1024x1024", "1024x576", "576x1024").',
      },
      count: {
        type: 'number',
        description: 'Số lượng ảnh cần sinh ra (mặc định 1, tối đa 4).',
      },
      style: {
        type: 'string',
        description: 'Phong cách nghệ thuật (ví dụ: chibi, anime, 3d, cinematic, vẽ màu nước...).',
      },
    },
    required: ['prompt'],
  };

  constructor(private readonly imageGenerationService: ImageGenerationService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: GenerateImageDto, context: ToolExecutionContext): Promise<any> {
    const res = await this.imageGenerationService.generateImage(input, context);
    return {
      success: res.success,
      fileId: res.fileId,
      imageId: res.imageId,
      modelId: res.modelId,
      actionType: res.actionType,
      storagePath: res.storagePath,
      localPath: res.localPath,
      url: res.url,
      costUsd: res.costUsd,
      warning: res.warning,
      message: res.url
        ? `Đã tạo ảnh thành công và gửi trực tiếp qua Zalo.`
        : res.localPath
        ? `Đã tạo ảnh thành công và lưu tại máy tính: ${res.localPath}`
        : 'Đã tạo ảnh thành công.',
    };
  }
}

@Injectable()
export class EditImageTool implements AgentTool<EditImageDto> {
  name = 'edit_image';
  description =
    'Chỉnh sửa hoặc biến đổi ảnh có sẵn (image-to-image) bằng OpenRouter Image API. Tự động lấy ảnh người dùng vừa gửi hoặc ảnh bot vừa sinh trong cùng cuộc trò chuyện nếu không điền sourceFileId.';
  riskLevel: 'MEDIUM' = 'MEDIUM';
  inputSchema = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Mô tả chi tiết các thay đổi cần thực hiện trên ảnh (ví dụ: "đổi nền thành trắng", "thay áo màu xanh", "biến thành chibi").',
      },
      sourceFileId: {
        type: 'string',
        description: 'ID file ảnh gốc cần chỉnh sửa (tùy chọn, để trống sẽ tự lấy ảnh gần nhất trong chat).',
      },
      aspectRatio: {
        type: 'string',
        description: 'Tỷ lệ khung hình mới (tùy chọn).',
      },
      resolution: {
        type: 'string',
        description: 'Độ phân giải mới (tùy chọn).',
      },
      count: {
        type: 'number',
        description: 'Số lượng ảnh kết quả (mặc định 1).',
      },
    },
    required: ['prompt'],
  };

  constructor(private readonly imageGenerationService: ImageGenerationService) {}

  requiresApproval(): boolean {
    return false;
  }

  async execute(input: EditImageDto, context: ToolExecutionContext): Promise<any> {
    const res = await this.imageGenerationService.editImage(input, context);
    return {
      success: res.success,
      fileId: res.fileId,
      imageId: res.imageId,
      modelId: res.modelId,
      actionType: res.actionType,
      storagePath: res.storagePath,
      localPath: res.localPath,
      url: res.url,
      costUsd: res.costUsd,
      warning: res.warning,
      message: res.url
        ? `Đã chỉnh sửa ảnh thành công và gửi trực tiếp qua Zalo.`
        : res.localPath
        ? `Đã chỉnh sửa ảnh thành công và lưu tại máy tính: ${res.localPath}`
        : 'Đã chỉnh sửa ảnh thành công.',
    };
  }
}
