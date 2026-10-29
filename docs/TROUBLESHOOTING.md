# XỬ LÝ SỰ CỐ & KHẮC PHỤC LỖI (TROUBLESHOOTING)

Tài liệu giải quyết các tình huống lỗi thường gặp khi phát triển và vận hành bot.

---

## 1. Bot không nhận tin nhắn ở chế độ Long Polling

### Triệu chứng:
Nhắn tin trên Zalo nhưng trong console `npm run dev:worker` không thấy log sự kiện mới.

### Nguyên nhân & Cách khắc phục:
1. **Xung đột Webhook**:
   - Theo tài liệu chính thức của Zalo Platform, **Webhook và Polling loại trừ lẫn nhau**. Nếu trước đó Bot đã từng được đăng ký Webhook URL, API `getUpdates` sẽ không trả về sự kiện.
   - Kiểm tra bằng lệnh:
     ```bash
     npm run zalo:webhook:info
     ```
   - Nếu `url` đang có giá trị, chạy lệnh xóa webhook:
     ```bash
     npm run zalo:webhook:delete
     ```
   - Sau đó khởi động lại `npm run dev:worker`.

2. **Chưa điền hoặc sai `ZALO_BOT_TOKEN`**:
   - Kiểm tra token bằng:
     ```bash
     npm run zalo:test
     ```
   - Nếu báo lỗi 401 hoặc token expired, hãy vào trang quản lý [Zalo Bot Creator](https://bot.zaloplatforms.com/) để lấy token mới và cập nhật vào `.env`.

3. **Chạy hai terminal poller cùng lúc**:
   - Không chạy nhiều hơn 1 tiến trình `dev:worker` cho cùng một bot token.

---

## 2. Bot trả lời "Bạn không có quyền truy cập" hoặc "Hệ thống chưa được ghép nối"

### Nguyên nhân:
Đây là Personal Agent bảo mật dành riêng cho một chủ sở hữu. Mọi tin nhắn từ người chưa ghép nối đều bị từ chối.

### Cách khắc phục:
1. Chạy lệnh sinh mã ghép nối:
   ```bash
   npm run owner:pair-code
   ```
2. Gửi tin nhắn `/pair <mã>` trên Zalo từ tài khoản chính chủ của bạn.
3. Nếu muốn đổi chủ sở hữu, truy cập database và reset bảng `User`:
   ```bash
   npx prisma studio
   ```

---

## 3. Không thể kết nối Database PostgreSQL hoặc Redis

### Triệu chứng:
Console báo `ECONNREFUSED 127.0.0.1:5433` hoặc `ECONNREFUSED 127.0.0.1:6380`.

### Cách khắc phục:
1. Kiểm tra trạng thái container Docker:
   ```bash
   docker ps --filter "name=personal_agent"
   ```
2. Nếu container chưa chạy, khởi động lại:
   ```bash
   docker compose up -d postgres redis
   ```
3. Chạy kiểm tra tự động:
   ```bash
   npm run doctor
   ```

---

## 4. Bot tạo file Excel / PDF thành công nhưng không gửi được link tải ra Zalo

### Nguyên nhân:
- File được tạo an toàn tại máy chủ local (`./data/private-outputs`).
- Các link `http://localhost:3000/...` không thể truy cập từ ứng dụng Zalo trên điện thoại hoặc máy tính khác mạng.
- Zalo Bot Official API không hỗ trợ đính kèm trực tiếp file binary thô (`sendDocument` không tồn tại trong API reference hiện tại).

### Cách khắc phục:
- Cấu hình **Cloudflare R2** (miễn phí lưu trữ 10GB và miễn phí băng thông tải ra ngoài) trong file `.env`:
  ```env
  STORAGE_PROVIDER=r2
  R2_ACCOUNT_ID=...
  R2_ACCESS_KEY_ID=...
  R2_SECRET_ACCESS_KEY=...
  R2_BUCKET=...
  ```
- Khi đã cấu hình R2, bot sẽ tự động tạo **HTTPS Signed Download Link** (thời hạn 15 phút) gửi trực tiếp cho bạn qua tin nhắn Zalo.

---

## 5. Lỗi kết nối Gmail OAuth (Redirect URI Mismatch)

### Triệu chứng:
Trang đăng nhập Google báo lỗi `redirect_uri_mismatch`.

### Cách khắc phục:
- Trong Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client IDs:
- Thêm chính xác URL sau vào mục **Authorized redirect URIs**:
  ```text
  http://localhost:3000/api/integrations/google/callback
  ```
