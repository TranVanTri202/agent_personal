# Zalo Official Bot Integration Guide (`zalo-bot-js`)

Tài liệu này mô tả kiến trúc tích hợp Zalo Official Bot SDK [`KaiyoDev/zalo-bot-js`](https://github.com/KaiyoDev/zalo-bot-js) vào Personal AI Agent Backend.

---

## 1. Tổng quan kiến trúc

```
               ┌────────────────────────────────────────────────────────┐
               │                  Zalo Official API                     │
               └──────────────────────────┬─────────────────────────────┘
                                          │
            ┌─────────────────────────────┴─────────────────────────────┐
            │                                                           │
   (Chế độ Polling: dev/local)                                 (Chế độ Webhook: prod)
            │                                                           │
   Bot.startPolling()                                            POST /api/webhooks/zalo
            │                                                           │
            ▼                                                           ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                            Bot ('message')                                 │
   │               (Single Canonical Handler - Chống trùng lặp)                │
   └──────────────────────────────────────┬─────────────────────────────────────┘
                                          │
                                          ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                           ZaloEventNormalizer                              │
   │  - Chuẩn hóa: chatId, senderId, chatType, text, stickerId, imageUrl, v.v.  │
   └──────────────────────────────────────┬─────────────────────────────────────┘
                                          │
                                          ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                           AgentService                                     │
   │  1. Kiểm tra xác thực Owner / Allowlist (Private Agent)                    │
   │  2. Nếu có phiên /sticker-add đang mở: Tự động ghi nhận sticker            │
   │  3. Lệnh hệ thống (/whoami, /permissions, /sticker-*, v.v.)               │
   │  4. Đưa vào hàng đợi AI Agent loop (OpenRouter Gateway + Tools)            │
   └────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Phiên bản & Yêu cầu môi trường

- **Thư viện SDK**: `zalo-bot-js` (phiên bản `0.2.3`).
- **Runtime**: Node.js >= 20.x, TypeScript >= 5.x.
- **Bot Type**: Zalo Official Bot API (không phải Zalo Personal Account/zca-js).

---

## 3. Quản trị kênh qua `IZaloChannel` & `ZaloChannelAdapter`

Tất cả các business service (`AgentService`, `StickerService`, `TaskProgressService`, `ReminderProcessor`) không phụ thuộc trực tiếp vào SDK, mà thông qua interface `IZaloChannel`:

```typescript
export interface IZaloChannel {
  sendText(chatId: string, text: string, opts?: SendTextOptions): Promise<unknown>;
  sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<unknown>;
  sendSticker(chatId: string, stickerId: string): Promise<unknown>;
  sendTyping(chatId: string): Promise<unknown>;
  sendVoice(chatId: string, voiceUrl: string): Promise<unknown>;
  sendFileLink(chatId: string, signedUrl: string, fileName: string): Promise<unknown>;
}
```

### Lưu ý đặc biệt về thứ tự tham số SDK:
SDK `zalo-bot-js` quy định chữ ký của hàm gửi ảnh:
`sendPhoto(chatId: string, caption: string, photo: string, options?: SendPhotoOptions)`
-> `ZaloChannelAdapter` tự động ánh xạ đúng vị trí: `(chatId, photoUrl, caption)` -> `bot.sendPhoto(chatId, caption || '', photoUrl)`.

---

## 4. Chế độ nhận tin (Receivers)

> **Nguyên tắc cốt lõi**: Duy nhất 1 receiver hoạt động tương ứng với giá trị cấu hình `ZALO_MODE`.

### 4.1 Chế độ Long Polling (`ZALO_MODE=polling`)
- Phù hợp khi phát triển local không cần mở port public hay ngrok.
- `ZaloPollerService` gắn duy nhất 1 listener canonical `bot.on('message', ...)`.
- Không đăng ký lặp lại các sự kiện con (`bot.on('text')`, `bot.command()`) để ngăn ngừa lỗi double-dispatch khi SDK phát nhiều event cùng lúc cho một tin nhắn.
- Tự động kiểm tra webhook conflict khi khởi động: nếu bot đang có webhook active, log cảnh báo và hướng dẫn chạy `npm run zalo:webhook:delete`.

### 4.2 Chế độ Webhook (`ZALO_MODE=webhook`)
- Phù hợp môi trường production trên VPS với HTTPS.
- Endpoint an toàn: `POST /api/webhooks/zalo`.
- Xác thực header `x-bot-api-secret-token` với `ZALO_WEBHOOK_SECRET`.
- Chuyển payload vào `bot.processUpdate(payload)` để tái sử dụng toàn bộ pipeline chuẩn hóa và xử lý thống nhất.

---

## 5. Thư viện & Phiên thu thập Sticker (`Sticker Collector`)

Hệ thống hỗ trợ quản lý thư viện sticker 2 tầng:
1. **File cấu hình tĩnh**: `config/stickers.json`.
2. **Cơ sở dữ liệu PostgreSQL**: Bảng `StickerItem` và `StickerSession`.

### Các lệnh quản lý sticker:
- `/sticker-add <nhóm>`: Mở phiên thu thập sticker cho nhóm cảm xúc (VD: `/sticker-add sorry`).
- Gửi sticker bất kỳ trong lúc mở phiên: Bot sẽ tự động trích xuất `stickerId`, chống trùng lặp và phản hồi ngay số sticker đã thu thập. Tin nhắn sticker không bị chuyển sang AI loop.
- `/sticker-status`: Xem tiến độ phiên thu thập hiện tại.
- `/sticker-done`: Đóng phiên, lưu toàn bộ sticker mới vào PostgreSQL và đồng bộ hóa vào `config/stickers.json`.
- `/sticker-cancel`: Hủy phiên thu thập mà không lưu thay đổi.
- `/sticker-list` (hoặc `/stickers`): Xem danh sách các nhóm cảm xúc và số lượng sticker.
- `/sticker-test <nhóm> [số lượng]`: Thử nghiệm bot gửi sticker theo cảm xúc.
- `/sticker-reload`: Nạp lại thư viện sticker từ đĩa và database.
- `/sticker-help`: Xem hướng dẫn chi tiết các lệnh sticker.

---

## 6. Ma trận năng lực (Capabilities Matrix)

| Chức năng | API SDK `zalo-bot-js` | Hỗ trợ thực tế | Ghi chú |
|---|---|---|---|
| Xác thực bot | `bot.getMe()` | ✅ Xác nhận | Trả về `User` (id, displayName, accountName, v.v.) |
| Gửi tin nhắn văn bản | `bot.sendMessage(chatId, text, opts)` | ✅ Xác nhận | Tự động phân đoạn an toàn (UTF-16) nếu vượt 2000 ký tự |
| Gửi ảnh | `bot.sendPhoto(chatId, caption, photo)` | ✅ Xác nhận | Đã map tham số qua adapter |
| Gửi sticker | `bot.sendSticker(chatId, stickerId)` | ✅ Xác nhận | Hoạt động tốt |
| Tín hiệu đang gõ | `bot.sendChatAction(chatId, 'typing')` | ✅ Xác nhận | Hoạt động tốt |
| Gửi tệp đính kèm | `bot.sendMessage` (Link ký Cloudflare R2 / Local) | ✅ Xác nhận | Link tải trực tiếp kèm hướng dẫn |
| Nhận tin nhắn / lệnh | `bot.on('message', cb)` | ✅ Xác nhận | Canonical handler chống duplicate |
| Polling nhận tin | `bot.startPolling()`, `bot.stopPolling()` | ✅ Xác nhận | Chạy ngầm không block lifecycle |
| Webhook | `bot.processUpdate(payload)` | ✅ Xác nhận | Tích hợp xác thực token an toàn |
