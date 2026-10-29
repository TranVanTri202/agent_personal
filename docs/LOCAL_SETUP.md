# HƯỚNG DẪN CÀI ĐẶT & CHẠY LOCAL (LOCAL SETUP GUIDE)

Tài liệu này hướng dẫn chi tiết cách khởi động Personal AI Agent ngay trên máy tính cá nhân.

---

## 1. Yêu cầu tiên quyết
- **Node.js**: Phiên bản >= 20.x (khuyến nghị Node 24 LTS).
- **Docker & Docker Compose**: Để chạy PostgreSQL (pgvector) và Redis.
- **Zalo Bot Token MỚI**: Tạo bot miễn phí tại [Zalo Bot Creator](https://bot.zaloplatforms.com/).

---

## 2. Các bước cài đặt nhanh

### Bước 1: Khởi động Hạ tầng (Docker)
Chạy PostgreSQL và Redis trên các cổng nội bộ an toàn (127.0.0.1:5433 và 127.0.0.1:6380):
```bash
docker compose up -d postgres redis
```

### Bước 2: Chuẩn bị file môi trường
Copy file mẫu `.env.example` sang `.env`:
```bash
cp .env.example .env
```
Mở file `.env` và điền:
- `ZALO_BOT_TOKEN`: Token bot Zalo mới của bạn (không dùng token cũ từng chia sẻ).
- `OPENAI_API_KEY`: API key từ OpenAI (nếu chưa có, hệ thống sẽ tự động dùng Mock LLM an toàn).

### Bước 3: Đồng bộ Cơ sở dữ liệu
Chạy migrate và seed dữ liệu ban đầu:
```bash
npm run setup
```

### Bước 4: Kiểm tra sức khỏe hệ thống
Kiểm tra kết nối và cấu hình trước khi chạy:
```bash
npm run doctor
```

---

## 3. Khởi chạy ứng dụng

### Terminal A: Khởi động HTTP API Server
```bash
npm run dev
```
Server sẽ lắng nghe tại `http://localhost:3000`.

### Terminal B: Khởi động Worker & Long Poller
```bash
npm run dev:worker
```
Worker sẽ kết nối Redis và bắt đầu vòng lặp Long Polling nhận tin nhắn từ Zalo Bot.

---

## 4. Ghép nối Chủ sở hữu (Owner Pairing)

1. Mở một terminal mới và chạy:
   ```bash
   npm run owner:pair-code
   ```
   Terminal sẽ in ra mã 6 chữ số (ví dụ: `642396`, hiệu lực trong 5 phút).

2. Mở ứng dụng Zalo trên điện thoại hoặc máy tính, tìm kiếm Bot của bạn và gửi:
   ```text
   /pair 642396
   ```

3. Bot sẽ phản hồi xác nhận bạn là **Chủ sở hữu (Owner)** duy nhất của AI Agent!
4. Giờ đây bạn có thể nhắn tin giao việc:
   - `/help`: Xem tất cả lệnh hỗ trợ.
   - `Tạo file Excel kế hoạch tuần này gồm công việc và trạng thái`
   - `Tạo file PDF tóm tắt quy trình`
   - `Mai 8h nhắc tôi gọi điện cho khách hàng A`
