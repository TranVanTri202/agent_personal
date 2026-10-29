# Hướng dẫn Thiết lập & Vận hành Supabase Temporary Storage (24-Hour TTL)

Tài liệu này hướng dẫn chi tiết về cơ chế lưu trữ file tạm với thời hạn sống chính xác **24 giờ cho từng file (per-file TTL)** sử dụng Supabase Storage Private Bucket và PostgreSQL metadata.

---

## 1. Nguyên tắc Cốt lõi (Key Principles)

1. **Chỉ dùng lưu file tạm:** Supabase chỉ được dùng làm kho lưu trữ file tạm cho bot (ảnh AI, file Excel, PDF, Word...). Cơ sở dữ liệu chính của dự án vẫn là PostgreSQL local/self-hosted hiện tại.
2. **Hạn dùng 24 giờ cho từng file (Per-File 24h Expiry):**
   - Mốc thời gian hết hạn được tính theo công thức:
     $$\text{expiresAt} = \text{uploadedAt} + 24\text{ giờ (UTC)}$$
   - Mỗi file có mốc hết hạn riêng biệt tính từ lúc upload thành công, **không phải xóa hàng loạt lúc 0h đêm**.
3. **Bucket Private hoàn toàn:** Không mở public bucket. File chỉ có thể được tải về thông qua **Signed Download URL** với thời hạn không vượt quá thời gian sống còn lại của file.
4. **Không xóa ảnh ngay khi gửi tin:** Sau khi gọi `sendPhoto` thành công về Zalo, ảnh vẫn được giữ nguyên vẹn trong 24 giờ để người dùng có thể tải về, xem lại hoặc tiếp tục yêu cầu chỉnh sửa ("chibi hóa ảnh này").

---

## 2. Kiến trúc Xóa 24 Giờ Hai Lớp (Two-Layer Deletion)

```mermaid
graph TD
    A[File được tạo: Excel/PDF/Word/Ảnh] --> B[Upload vào Supabase Storage Bucket 'agent-temp']
    B --> C[Lưu DB: status = 'ACTIVE', expiresAt = now + 24h]
    C --> D[Lớp A: Enqueue BullMQ delayed job 'delete-temporary-file' với delay 24h]
    
    subgraph "Sau 24 giờ..."
        D --> E[Worker nhận job -> Kiểm tra expiresAt <= now]
        E --> F[Atomic lease: status = 'DELETING']
        F --> G[Gọi Supabase Storage API remove([objectPath])]
        G --> H[Cập nhật DB: status = 'DELETED', deletedAt = now]
    end

    subgraph "Lớp B: Sweeper Khôi phục (Mỗi 5 phút & Khi khởi động)"
        S[Sweeper Service] --> T{Quét DB: status in [ACTIVE, DELETE_FAILED] & expiresAt <= now}
        T -- Có file sót --> U[Xóa an toàn khỏi Supabase Storage & Đánh dấu DELETED]
    end
```

### Lớp A — BullMQ Delayed Job (Cơ chế chính)
- Ngay khi file upload thành công, một delayed job được thêm vào hàng đợi `temporary-files-queue` với độ trễ:
  `delay = Math.max(0, expiresAt.getTime() - Date.now())` (xấp xỉ 86,400,000 ms).
- JobId duy nhất: `temp-delete-${fileId}`.
- Khi đến hạn, `TemporaryFileCleanupProcessor` kích hoạt xóa đối tượng trên Supabase Storage và chuyển trạng thái sang `DELETED`.

### Lớp B — Recovery Sweeper (Cơ chế tự phục hồi)
- Chạy quét ngay khi Worker/Server khởi động và lặp lại định kỳ **mỗi 5 phút**.
- Quét các file có trạng thái `ACTIVE` hoặc `DELETE_FAILED` mà `expiresAt <= now` (ví dụ do server/worker tắt đúng vào thời điểm 24h hoặc Redis bị restart).
- Tự động xóa dọn dẹp để đảm bảo không có object nào tồn tại quá 24h.

---

## 3. Hướng dẫn Cấu hình Supabase Storage

### Bước 1: Đăng ký & Tạo Project
1. Đăng ký tài khoản miễn phí tại [https://supabase.com](https://supabase.com).
2. Tạo project mới (ví dụ: `personal-zalo-storage`). Lưu ý: Bạn **không cần** kết nối database của Supabase cho NestJS.

### Bước 2: Tạo Private Bucket
1. Mở Supabase Dashboard, điều hướng đến **Storage** > **New bucket**.
2. Đặt tên bucket: `agent-temp`.
3. Tùy chọn **Public bucket**: **TẮT (Để Private)**.
4. Bấm **Save**.

### Bước 3: Lấy API Credentials
1. Mở **Project Settings** > **API**.
2. Sao chép mục **Project URL** (dạng `https://xxxx.supabase.co`).
3. Sao chép mục **service_role** secret key (lưu ý: dùng key `service_role` phía server, tuyệt đối không dùng key `anon`).

### Bước 4: Cấu hình biến môi trường `.env`
Mở file `.env` trong thư mục dự án và điền:

```dotenv
# Supabase chỉ dùng để lưu file tạm (tự động xóa sau 24h); PostgreSQL vẫn là DB hiện tại
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=agent-temp
```

### Bước 5: Kiểm tra kết nối
Chạy script kiểm tra:

```bash
npm run storage:setup
```

Kết quả mong đợi:
```text
📦 === SUPABASE TEMPORARY STORAGE SETUP ===
• Supabase URL: https://xxxx.supabase.co
• Bucket mục tiêu: agent-temp (Private)
✅ Bucket "agent-temp" đã tồn tại trên Supabase Storage!
   - Public: ✅ PRIVATE (Đúng chuẩn bảo mật)
🎉 Supabase Storage đã sẵn sàng hoạt động với thời hạn tự động xóa 24 giờ cho từng file!
```

---

## 4. Các Lệnh Quản trị & CLI

| Lệnh | Ý nghĩa |
| :--- | :--- |
| `npm run storage:setup` | Kiểm tra kết nối Supabase Storage và tạo bucket `agent-temp` nếu chưa có |
| `npm run storage:check` | Xem thống kê số lượng file tạm đang hoạt động, file đã hết hạn, file đã xóa và 5 file sắp hết hạn sớm nhất |
| `npm run storage:cleanup` | Kích hoạt quét và xóa ngay các file đã quá hạn 24 giờ khỏi Supabase Storage |

Trên chat Zalo:
- Nhắn `/files` để xem danh sách các file tạm đang còn hạn kèm thời gian hết hạn dự kiến.
- Nhắn `/health` để xem trạng thái kết nối Storage.

---

## 5. Quy tắc Trải nghiệm Người dùng (UX & Bảo mật)

1. **Thông báo thời hạn rõ ràng:** Khi sinh link tải cho người dùng, bot luôn gửi kèm thông điệp:
   > *"🔗 Link tải có hiệu lực trong 24 giờ kể từ lúc tạo file ⏰: https://..."*
2. **Xử lý khi file đã hết hạn:**
   - Nếu người dùng bấm vào link cũ hoặc nhắn xin lại link của file đã quá 24h: Bot thông báo rõ ràng rằng file đã hết hạn lưu trữ tạm và mời người dùng yêu cầu tạo file mới.
   - Khi chỉnh sửa ảnh (`edit_image`): Nếu ảnh gốc đã quá 24h, bot sẽ yêu cầu gửi ảnh mới chứ không báo lỗi hệ thống khó hiểu.
3. **Kiểm soát quyền truy cập:**
   - Người dùng lạ không thể tải file của Chủ sở hữu (Owner) kể cả khi đoán được ID file.
