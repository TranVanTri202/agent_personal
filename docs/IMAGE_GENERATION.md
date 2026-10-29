# TÍCH HỢP TẠO & CHỈNH SỬA ẢNH BẰNG OPENROUTER TRÊN PERSONAL ZALO AGENT

Tài liệu hướng dẫn kiến trúc và cách sử dụng tính năng **Text-to-Image (Tạo ảnh mới)** và **Image-to-Image (Chỉnh sửa ảnh)** sử dụng **OpenRouter dedicated Image API** (`https://openrouter.ai/api/v1/images`), gửi kết quả trực tiếp qua Zalo bằng SDK `zalo-bot-js`.

---

## 1. Kiến trúc & Nguyên lý hoạt động

### 1.1. Dedicated Image API
Hệ thống sử dụng endpoint chuyên dụng của OpenRouter dành riêng cho việc sinh ảnh:
- **Endpoint:** `POST https://openrouter.ai/api/v1/images`
- **Authentication:** `Authorization: Bearer ${OPENROUTER_API_KEY}` (dùng chung API key hiện có)
- **Model kiểm tra năng lực:** `GET https://openrouter.ai/api/v1/images/models` để xác định các thông số được hỗ trợ (`aspect_ratio`, `resolution`, `n`, `input_references`).

### 1.2. Công cụ (Agent Tools)
1. **`generate_image`**:
   - Nhận yêu cầu tạo ảnh từ mô tả văn bản tiếng Việt/tiếng Anh.
   - Hỗ trợ tỷ lệ khung hình (`aspectRatio`: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`), độ phân giải (`resolution`), số lượng (`count`), phong cách (`style`).
2. **`edit_image`**:
   - Nhận yêu cầu chỉnh sửa hoặc biến đổi ảnh đã có.
   - Tự động lấy ảnh tham chiếu (`ImageContextService`):
     - Ưu tiên 1: `sourceFileId` nếu chỉ định cụ thể.
     - Ưu tiên 2: Ảnh người dùng vừa gửi gần nhất trong cuộc trò chuyện (tự động tải và lưu bản gốc vào storage).
     - Ưu tiên 3: Ảnh bot vừa sinh gần nhất trong cùng cuộc trò chuyện.
   - Truyền ảnh tham chiếu dưới dạng `input_references`:
     ```json
     {
       "model": "qwen/qwen-image-2.1-turbo",
       "prompt": "Đổi nền thành màu trắng, phong cách studio",
       "input_references": [
         {
           "type": "image_url",
           "image_url": { "url": "data:image/jpeg;base64,..." }
         }
       ]
     }
     ```

### 1.3. Gửi ảnh về Zalo (`zalo-bot-js`)
- Signature SDK: `sendPhoto(chatId, caption, photoUrl, options)`
- Khi lưu trữ ảnh vào Cloudflare R2, hệ thống sinh presigned URL để Zalo OpenAPI tải và hiển thị trực tiếp ảnh trong tin nhắn.
- Nếu gửi qua Zalo OpenAPI gặp trục trặc, hệ thống có cơ chế fallback gửi link tải hoặc đường dẫn tệp tin an toàn để người dùng không bị lỡ công việc.

---

## 2. Cấu hình Môi trường (.env)

Bổ sung các biến cấu hình sau trong file `.env`:

```env
# ================= OPENROUTER IMAGE GENERATION & EDITING =================
# Model ID hợp lệ tại OpenRouter Image Models (mặc định: qwen/qwen-image-2.1-turbo)
OPENROUTER_IMAGE_MODEL=qwen/qwen-image-2.1-turbo

# Tùy chọn: model riêng dành cho tác vụ chỉnh sửa ảnh (phải hỗ trợ input_references)
# Nếu để trống, hệ thống sẽ tái sử dụng OPENROUTER_IMAGE_MODEL
OPENROUTER_IMAGE_EDIT_MODEL=
```

> **Gợi ý model:**
> - `qwen/qwen-image-2.1-turbo`: Hỗ trợ cả Text-to-Image và Image-to-Image (`input_references` lên tới 4 ảnh).
> - `google/gemini-2.5-flash-image`: Hỗ trợ sinh ảnh và chỉnh sửa linh hoạt.
> - `black-forest-labs/flux-1-schnell` / `black-forest-labs/flux-1-dev`: Chất lượng ảnh cao cho Text-to-Image.

---

## 3. Bảo mật & Phân quyền (Security & Permissions)

- **Owner Only:** Vì việc sinh ảnh tiêu tốn credits thực tế trên OpenRouter, chỉ chủ sở hữu đã xác thực (Owner) mới được phép thực thi `generate_image` và `edit_image`.
- **Ngăn rò rỉ dữ liệu:**
  - Không bao giờ ghi log chuỗi Base64 của ảnh.
  - Ảnh của từng cuộc trò chuyện/người dùng được phân lập hoàn toàn; khách hoặc nhóm không thể truy vấn hay chỉnh sửa ảnh của Owner.
- **Bản gốc an toàn:** Bản gốc người dùng gửi không bao giờ bị ghi đè khi chỉnh sửa. Mọi kết quả chỉnh sửa được lưu thành tệp riêng biệt và liên kết qua `parentImageId` trong bảng `GeneratedImage`.

---

## 4. Kiểm tra & Chạy thử

### 4.1. Unit & Integration Tests (Mock)
Chạy bộ kiểm thử hoàn toàn không tốn credits:
```bash
npm test
```

### 4.2. Live Smoke Test (Manual)
Lệnh kiểm tra trực tiếp với OpenRouter API và tài khoản thực (có cảnh báo tiêu tốn credits):
```bash
npm run test:image:live
```
Hoặc chỉ định model cụ thể:
```bash
npm run test:image:live -- --model qwen/qwen-image-2.1-turbo
```
Ảnh mẫu sinh ra sẽ được lưu tại thư mục `data/smoke-test/`.

### 4.3. Thao tác trên Zalo Chat
1. **Tạo ảnh:**
   - `Tạo ảnh một chú mèo chibi đang ngồi gõ code, tỷ lệ 1:1`
   - `Vẽ cho tôi banner phong cảnh hoàng hôn trên biển, 16:9`
2. **Chỉnh sửa ảnh vừa gửi:**
   - Gửi 1 bức ảnh vào chat Zalo, kèm tin nhắn: `Đổi nền thành màu trắng studio`
   - Hoặc gửi ảnh trước, sau đó nhắn: `Chuyển ảnh này sang phong cách anime`
3. **Chỉnh tiếp ảnh vừa sinh:**
   - Sau khi bot gửi ảnh kết quả, nhắn: `Đổi màu áo của nhân vật thành màu xanh dương`
