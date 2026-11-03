# Personal AI Agent qua Zalo Bot Official API (Local-First)

Hệ thống **Personal AI Agent** điều khiển bằng tiếng Việt qua **Zalo Bot Official API** dành cho một chủ sở hữu duy nhất. Chạy mượt mà trên máy tính cá nhân (local-first) không cần VPS, không cần domain công khai nhờ cơ chế **Long Polling (`getUpdates`)**, tích hợp đầy đủ PostgreSQL (pgvector), Redis (BullMQ), NestJS, OpenAI API, hệ thống phê duyệt thao tác nhạy cảm (Approvals), tạo tài liệu (Excel/PDF/Word) và quản lý email Gmail.

---

## Tính năng nổi bật

- 🤖 **Zalo Official Bot Integration**: Kết nối trực tiếp qua Zalo Bot Platform API (`https://bot-api.zaloplatforms.com`). Hỗ trợ Long Polling và Webhook. Tự động chia nhỏ tin nhắn Unicode <= 2000 ký tự an toàn với emojis.
- 🔐 **Owner Auth & Pairing**: Chỉ duy nhất một chủ sở hữu được cấp quyền. Ghép nối một chạm qua mã một lần (`npm run owner:pair-code` và `/pair <code>`). Người lạ hoặc tin nhắn nhóm không thể truy cập.
- 🧠 **OpenRouter Gateway & Dynamic Routing**:
  - Hỗ trợ toàn diện 2 chế độ:
    1. **`single` mode**: 100% tác vụ định tuyến qua một mô hình duy nhất (`LLM_SINGLE_MODEL`), bỏ qua classification tốn kém, kiểm tra năng lực (tool/vision) chặt chẽ.
    2. **`task` mode**: Định tuyến tối ưu theo 13 danh mục tác vụ qua `config/llm-routing.json` (hỗ trợ `rules` và `adaptive`).
  - Chỉ cần 1 `OPENROUTER_API_KEY` truy cập hàng trăm model (Claude 3.5 Sonnet/Haiku, GPT-4o/mini, Gemini 1.5/2.5, DeepSeek V3/R1).
  - Tự động ghi nhận chi phí USD, tokens và độ trễ vào bảng `LLMUsageLog`. Giới hạn ngân sách hàng ngày `LLM_DAILY_BUDGET_USD`.
- 📊 **Tạo & Đọc tài liệu tự động**: Tự sinh file Excel (.xlsx), PDF (.pdf), Word (.docx) từ yêu cầu bằng ngôn ngữ tự nhiên; đồng thời hỗ trợ **đọc & phân tích file đính kèm** (`.xlsx`, `.docx`, `.pdf`, `.csv`, `.txt`) khi người dùng gửi trực tiếp vào Zalo (`read_uploaded_document`).
- 🌐 **Tìm kiếm Web & Đọc nội dung Link (`web_search` & `fetch_url`)**: Tra cứu thông tin thời gian thực (giá vàng, tỷ giá, tin tức, thời tiết) qua Tavily / DuckDuckGo / OpenRouter Online và đọc/tóm tắt nội dung bất kỳ đường link bài báo nào gửi vào chat (có bảo vệ chống SSRF).
- 🧠 **Bộ nhớ dài hạn thông minh (Long-term Memory)**: Tự động nạp các ghi nhớ quan trọng của chủ sở hữu vào ngữ cảnh hội thoại, tìm kiếm đa từ khóa (`memory_save`, `memory_search`, `memory_delete`) và quản lý qua lệnh `/memories`.
- 🎙️ **Xử lý tin nhắn thoại (Voice Message STT)**: Tự động chuyển đổi ghi âm giọng nói tiếng Việt trên Zalo thành văn bản và thực thi lệnh ngay lập tức.
- 💾 **Supabase Temporary Storage (24-Hour TTL)**: Lưu trữ file tạm (Excel, PDF, Word, ảnh AI) trong private bucket Supabase Storage (`agent-temp`). Từng file tự động xóa sau đúng **24 giờ** tính từ thời điểm upload thành công nhờ kiến trúc 2 lớp (BullMQ delayed job + Recovery Sweeper). Sinh HTTPS signed download URL an toàn, không mở public bucket.
- 📧 **Gmail Agent**: Kết nối Google OAuth2, mã hóa token AES-256-GCM, đọc/tóm tắt hộp thư, tạo bản nháp và gửi email an toàn.
- 🛡️ **Human-in-the-loop Approvals**: Mọi hành động rủi ro cao (gửi email thật, xóa file) đều bắt buộc yêu cầu chủ sở hữu duyệt qua mã `/approve <mã>`.
- ⏰ **Nhắc việc thông minh & Định kỳ (Recurring Reminders + Morning Briefing)**: Lên lịch nhắc nhở 1 lần hoặc lặp lại (`DAILY`, `WEEKLY`, `WEEKDAYS`, `MONTHLY`) theo múi giờ `Asia/Ho_Chi_Minh` và tổng hợp Bản tin sáng (`/briefing`).

---

## Bắt đầu nhanh (Quick Start)

### 1. Khởi động Docker containers
```bash
docker compose up -d postgres redis
```
*(Chạy PostgreSQL trên cổng `5433` và Redis trên cổng `6380` tránh xung đột với các dịch vụ có sẵn trên máy).*

### 2. Cấu hình biến môi trường
```bash
cp .env.example .env
```
Mở `.env` và điền:
- `ZALO_BOT_TOKEN`: Token bot Zalo mới lấy từ [Zalo Bot Creator](https://bot.zaloplatforms.com/).
- `OPENROUTER_API_KEY`: API key của OpenRouter (truy cập toàn bộ models; nếu để trống hệ thống dùng Mock LLM).
- `LLM_ROUTING_MODE`: `single` (mặc định) hoặc `task`.
- `LLM_SINGLE_MODEL`: Model cố định khi ở chế độ single (ví dụ: `openai/gpt-4o-mini`).

### 3. Đồng bộ Database
```bash
npm run setup
```

### 4. Kiểm tra sức khỏe hệ thống & LLM Routing
```bash
npm run doctor
npm run llm:validate-routing
npm run llm:smoke
```

### 5. Khởi chạy hệ thống
Chạy toàn bộ hệ thống (HTTP Server + Zalo Long Polling + BullMQ Workers) chỉ với 1 tiến trình duy nhất:
```bash
npm run dev
```
*(Tùy chọn: Nếu muốn chạy thêm tiến trình Worker chuyên biệt ở terminal thứ 2 bằng `npm run dev:worker`, hệ thống sẽ tự động tắt Zalo Polling ở Worker để tránh xung đột `getUpdates`).*

### 6. Ghép nối với tài khoản Zalo của bạn
1. Trong terminal, chạy:
   ```bash
   npm run owner:pair-code
   ```
2. Mở Zalo, tìm bot của bạn và nhắn:
   ```text
   /pair <MÃ_HIỂN_THỊ>
   ```
3. Bot sẽ xác nhận ghép nối thành công. Giờ bạn có thể ra lệnh!

---

## Danh sách Lệnh Bot (Bot Commands)

| Lệnh | Ý nghĩa |
|---|---|
| `/start`, `/help` | Xem hướng dẫn và các tính năng đang bật |
| `/whoami` | Xem ID và thông tin tài khoản Zalo |
| `/permissions` | Xem danh sách công cụ và mức độ rủi ro |
| `/tasks` | Xem danh sách các tác vụ gần đây |
| `/approvals` | Xem các yêu cầu đang chờ phê duyệt |
| `/approve <code>` | Phê duyệt thực thi thao tác (gửi email, xóa dữ liệu) |
| `/deny <code>` | Từ chối hủy bỏ thao tác |
| `/files` | Xem danh sách các file đã tạo |
| `/memories` | Xem danh sách bộ nhớ dài hạn về chủ sở hữu |
| `/memory-del <id>` | Xóa một ghi nhớ dài hạn theo mã ID |
| `/briefing` | Xem Bản tin sáng tổng hợp lịch nhắc việc trong ngày & ghi nhớ quan trọng |
| `/sticker-add <nhóm>` | Mở phiên thu thập sticker mới cho nhóm cảm xúc (VD: `/sticker-add sorry`) |
| `/sticker-done` | Kết thúc phiên thu thập và lưu vào PostgreSQL & stickers.json |
| `/sticker-status` | Xem số lượng sticker đã nhận trong phiên hiện tại |
| `/sticker-cancel` | Hủy bỏ phiên thu thập hiện tại |
| `/sticker-list`, `/stickers` | Xem danh sách tất cả nhóm cảm xúc và số lượng sticker |
| `/sticker-test <nhóm> [số lượng]` | Thử nghiệm bot gửi sticker theo cảm xúc |
| `/sticker-reload` | Nạp lại thư viện sticker từ đĩa và database |
| `/sticker-help` | Hướng dẫn chi tiết các lệnh quản lý sticker |
| `/mail connect` | Lấy link kết nối Gmail qua Google OAuth |
| `/mail status` | Kiểm tra tình trạng kết nối Gmail |
| `/reminders` | Xem danh sách việc cần làm đã lên lịch |
| `/reminder-test` | Thử nghiệm hẹn giờ nhắc việc sau 60 giây (tự động nhận tin nhắn) |
| `/reminder-cancel <id>` | Hủy một lời nhắc theo mã ID |
| `/reminder-health` | Kiểm tra hàng đợi BullMQ và tình trạng nhắc nhở |
| `/health` | Kiểm tra tình trạng server, database và redis |

---

## Kiểm thử (Testing)

```bash
# Chạy toàn bộ Unit & Integration tests (15 suites, 94 tests)
npm test

# Kiểm tra TypeScript type safety
npm run typecheck

# Build NestJS production bundle
npm run build
```

---

## Tài liệu chi tiết trong thư mục `docs/`
- [docs/ZALO_INTEGRATION.md](docs/ZALO_INTEGRATION.md) - Hướng dẫn tích hợp Zalo Official Bot SDK `zalo-bot-js`
- [docs/STICKERS.md](docs/STICKERS.md) - Hướng dẫn thu thập & quản lý sticker
- [docs/OPENROUTER_INTEGRATION.md](docs/OPENROUTER_INTEGRATION.md) - Hướng dẫn OpenRouter Gateway & Routing
- [docs/AGENT_PERSONA_AND_PROGRESS.md](docs/AGENT_PERSONA_AND_PROGRESS.md) - Phong cách hội thoại & tiến độ thời gian thực
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Thiết kế kiến trúc & sơ đồ luồng dữ liệu
- [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) - Hướng dẫn chi tiết chạy local
- [docs/SECURITY.md](docs/SECURITY.md) - Tiêu chuẩn bảo mật, mã hóa & chống SSRF
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Hướng dẫn gỡ lỗi & xử lý sự cố
- [docs/DEPLOYMENT_VPS.md](docs/DEPLOYMENT_VPS.md) - Hướng dẫn chuyển lên VPS Ubuntu với Webhook & Docker
