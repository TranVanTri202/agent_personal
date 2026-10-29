import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { GmailService } from './gmail.service';

@Controller('api/integrations/google')
export class GmailController {
  constructor(private readonly gmailService: GmailService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e53e3e;">Lỗi xác thực Google</h1>
            <p>Thiếu tham số code hoặc state từ Google OAuth.</p>
          </body>
        </html>
      `);
    }

    const result = await this.gmailService.handleCallback(code, state);
    if (!result.success) {
      return res.status(500).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e53e3e;">Kết nối thất bại</h1>
            <p>${result.error || 'Có lỗi xảy ra khi xử lý token'}</p>
          </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #38a169;">Kết nối Gmail thành công!</h1>
          <p>Tài khoản <strong>${result.email}</strong> đã được đồng bộ với AI Agent.</p>
          <p>Bây giờ bạn có thể quay lại Zalo và nhắn <code>/mail status</code> để kiểm tra.</p>
        </body>
      </html>
    `);
  }
}
