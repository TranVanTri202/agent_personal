# KIẾN TRÚC HỆ THỐNG (SYSTEM ARCHITECTURE)

## 1. Tổng quan
Hệ thống **Personal AI Agent qua Zalo Bot Official API** được thiết kế theo mô hình **Local-first Modular Monolith**.
- Hoạt động ổn định trên máy tính cá nhân (local development) mà không cần VPS hay domain công khai nhờ chế độ **Long Polling (`getUpdates`)**.
- Cho phép triển khai lên VPS production mà không phải sửa đổi business logic (chỉ cần chuyển `ZALO_MODE=webhook`).
- Thiết kế riêng cho **một chủ sở hữu duy nhất (Single-owner Personal Agent)**: mặc định từ chối mọi yêu cầu từ người lạ.

## 2. Sơ đồ luồng dữ liệu (Data Flow)

```text
Zalo App (Chủ sở hữu)
       │
       ▼
Zalo Official Bot Platform (bot-api.zaloplatforms.com)
       │
       ├─► Development: POST /bot{TOKEN}/getUpdates (Long Polling, outbound HTTP)
       └─► Production:  POST /api/webhooks/zalo (HTTPS Webhook có Secret Token)
       │
       ▼
Zalo Transport Layer (ZaloApiClient + ZaloPollerService / ZaloWebhookController)
       │
       ▼
Event Normalizer & Deduplication (InboundEvent table, canonical schema)
       │
       ▼
Owner Guard & Authorization (AuthService: Pairing code, role verification)
       │
       ▼
Conversation & Message Store (PostgreSQL: conversations, messages)
       │
       ▼
Agent Orchestration Runtime (AgentService)
       │
       ├─► LLM Provider (OpenAI GPT-4o / GPT-4o-mini / MockLLM offline fallback)
       ├─► Tool Registry & Execution Context
       │     ├─► Documents: ExcelJS (.xlsx), pdf-lib (.pdf), docx (.docx)
       │     ├─► Storage: LocalPrivateStorage (./data) / Cloudflare R2 (S3 API)
       │     ├─► Memory: PostgreSQL Long-term memory store
       │     ├─► Reminders: BullMQ delayed queue (Asia/Ho_Chi_Minh)
       │     └─► Gmail: REST API (OAuth2, encrypted tokens at rest)
       │
       ├─► Approval Boundary (ApprovalsService: HMAC exactActionHash, 6-digit code)
       │
       ▼
Delivery Layer (ZaloApiClient: sendMessage Unicode chunking, sendPhoto, sendVoice)
       │
       ▼
Zalo App (Nhận phản hồi, file link, thông báo nhắc nhở)
```

## 3. Các thành phần chính

### 3.1 Transport & Polling (`src/modules/zalo/`)
- `ZaloApiClient`: Tương tác với Zalo Bot API, tự động redact token trong URL (`/bot[REDACTED_TOKEN]/`).
- Hỗ trợ chia nhỏ tin nhắn Unicode <= 2000 ký tự không làm vỡ surrogate pairs (emojis) và ngắt theo đoạn văn.
- `ZaloPollerService`: Chạy vòng lặp long polling `POST /bot{TOKEN}/getUpdates`, timeout 30s. Tự động kiểm tra xung đột webhook trước khi nhận tin.

### 3.2 Xác thực & Phân quyền Chủ sở hữu (`src/modules/auth/`)
- Mặc định hệ thống ở trạng thái `UNPAIRED`.
- Người dùng chạy CLI `npm run owner:pair-code` để sinh mã 6 chữ số ngẫu nhiên, lưu hash SHA-256 trong 5 phút.
- Gửi tin nhắn `/pair <mã>` trên Zalo để hoàn tất ghép nối vĩnh viễn với `from.id`.

### 3.3 Cơ chế Phê duyệt thao tác nhạy cảm (`src/modules/approvals/`)
- Các tool rủi ro cao (ví dụ: `gmail_send_email`) không bao giờ tự động thực thi.
- Sinh mã phê duyệt ngẫu nhiên, gắn với digest HMAC SHA-256 của action type và payload.
- Chủ sở hữu duyệt bằng lệnh `/approve <mã>` hoặc từ chối `/deny <mã>`.

### 3.4 Lưu trữ & Tệp tin (`src/modules/storage/`, `src/modules/files/`)
- `LocalStorageProvider`: Lưu trữ file local tại `./data/private-outputs`, bảo vệ chống path traversal.
- `R2StorageProvider`: Tạo presigned HTTPS URLs có thời hạn (900s) khi có cấu hình Cloudflare R2.
- Tạo tự động bảng tính Excel, tài liệu PDF, tài liệu Word trực tiếp từ câu lệnh tự nhiên của chủ sở hữu.
