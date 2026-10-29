# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG (DEPLOYMENT GUIDE)

Tài liệu này tổng hợp các bước triển khai Personal Zalo AI Agent ở cả môi trường phát triển (Local-First) và môi trường máy chủ sản xuất (VPS).

---

## 1. Môi trường Local-First (Chạy trên máy tính cá nhân)

### Bước 1: Khởi động Containers (PostgreSQL & Redis)
```bash
docker compose up -d postgres redis
```
- PostgreSQL chạy cổng `5433` (tránh đụng cổng 5432 nếu máy có sẵn Postgres).
- Redis chạy cổng `6380`.

### Bước 2: Cấu hình `.env`
Sao chép từ `.env.example`:
```bash
cp .env.example .env
```
Điền các giá trị chính:
- `ZALO_BOT_TOKEN`: Token lấy từ Zalo Bot Creator.
- `OPENROUTER_API_KEY`: API Key OpenRouter.
- `STORAGE_PROVIDER=supabase`
- `SUPABASE_URL`: Project URL của Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Secret service_role key.
- `SUPABASE_STORAGE_BUCKET=agent-temp`

### Bước 3: Đồng bộ Database & Storage
```bash
npm run setup
npm run storage:setup
npm run doctor
```

### Bước 4: Khởi chạy ứng dụng
Mở 2 cửa sổ terminal:
- **Terminal A (API Server)**:
  ```bash
  npm run dev
  ```
- **Terminal B (Worker & Poller)**:
  ```bash
  npm run dev:worker
  ```

---

## 2. Triển khai Production lên VPS

### Kiến trúc Khuyến nghị:
- **OS**: Ubuntu 22.04 / 24.04 LTS (2 vCPU, 4GB RAM).
- **Process Manager**: PM2 hoặc Docker Compose.
- **Reverse Proxy**: Caddy (tự động cấp SSL HTTPS) hoặc Nginx.
- **Zalo Mode**: `ZALO_MODE=webhook` với webhook URL `https://your-domain.com/api/webhooks/zalo`.
- **File Storage**: Supabase Storage Private Bucket `agent-temp` với cơ chế tự động xóa sau 24 giờ.

### Các biến môi trường Production:
```dotenv
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://your-domain.com
APP_TIMEZONE=Asia/Ho_Chi_Minh

ZALO_BOT_TOKEN=your_production_token
ZALO_MODE=webhook
ZALO_WEBHOOK_URL=https://your-domain.com/api/webhooks/zalo
ZALO_WEBHOOK_SECRET=your_secure_secret_token

STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_STORAGE_BUCKET=agent-temp

DATABASE_URL=postgresql://personal_agent:secure_pass@localhost:5433/personal_agent?schema=public
REDIS_URL=redis://localhost:6380
```

### Lệnh chạy Production:
```bash
# Build dự án
npm run build

# Start API server
npm run start:prod

# Start Worker daemon
npm run start:worker
```
