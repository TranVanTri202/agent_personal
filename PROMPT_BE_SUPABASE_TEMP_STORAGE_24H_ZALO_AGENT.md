# BACKEND IMPLEMENTATION PROMPT — SUPABASE TEMPORARY STORAGE (24-HOUR TTL)

> Đưa **toàn bộ file này** cho AI Coding trong VS Code. Hãy **sửa project NestJS Personal AI Agent hiện tại**, không tạo dự án mới.
>
> **Quyết định cuối cùng:** Không dùng Cloudflare R2 hoặc Firebase Storage. Dùng **Supabase Storage chỉ để lưu file tạm**, mỗi file **tự động xóa sau 24 giờ tính từ thời điểm upload thành công của chính file đó**, không phải xóa chung lúc 0h.

## 0. Vai trò & yêu cầu triển khai

Bạn là Senior NestJS Backend Engineer và DevOps Engineer. Trực tiếp kiểm tra workspace hiện tại, tìm các abstraction và luồng xử lý file đang có, sau đó **triển khai đầy đủ**, chạy typecheck, build, test và cập nhật tài liệu. Không chỉ viết hướng dẫn hoặc pseudo-code.

Dự án hiện có/định hướng:
- NestJS + TypeScript, Prisma + **PostgreSQL local/self-hosted** (không chuyển database sang Supabase).
- Redis + BullMQ, worker chạy độc lập, có thể restart.
- Zalo Official Bot sử dụng `zalo-bot-js` qua `ZaloChannelAdapter`.
- OpenRouter LLM; Agent Tool Calling; Vision, Image Generation/Editing; Gmail; tạo Excel/PDF/Word; Memory; Reminder; quyền Owner/Public/Group.

**Chỉ thay module storage và các chỗ tích hợp liên quan.** Không viết lại Zalo bot, AI runtime, LLM routing, Gmail, reminders hoặc conversation engine.

Ưu tiên dùng lại cấu trúc code thực tế đang có. Không tự giả định tên class, Prisma model, DB schema hay đường dẫn file; phải kiểm tra trước khi chỉnh sửa. Nếu tính năng nào chưa tồn tại, tạo adapter tương thích theo thiết kế hiện tại.

## 1. Mục tiêu sản phẩm

Khi người dùng nhắn Zalo:

> "Tạo cho tôi file Excel quản lý chi phí và gửi về đây."

Hệ thống thực hiện:
1. Nhận lệnh, phản hồi ACK nhanh: "Dạ, em nhận việc rồi ạ. Để em tạo file nhé!"
2. Agent chạy công cụ tạo file và lưu đầu ra trong vùng tạm local (có cleanup).
3. Backend upload file **lên Supabase Storage private bucket**.
4. Lưu `bucket`, `objectPath`, `uploadedAt`, `expiresAt`, chủ sở hữu và trạng thái vào **PostgreSQL hiện tại**.
5. Tạo signed URL có thời hạn phù hợp; gửi link tải cho người dùng qua Zalo. Đối với ảnh, ưu tiên SDK `sendPhoto` nếu URL ảnh signed có thể được máy chủ Zalo tải thành công.
6. Báo thành công **chỉ khi** upload và gửi tin thành công; nếu lỗi, phản hồi rõ lỗi thực tế.
7. Đến **đúng hoặc ngay sau** mốc `uploadedAt + 24 giờ`, worker xóa file khỏi Supabase Storage. Job được thiết kế idempotent và có khả năng phục hồi.
8. Dữ liệu hội thoại có thể giữ lại metadata tối thiểu, nhưng không được coi file đã xóa là còn tải được; không để link/tài liệu đã hết hạn tồn tại như tài nguyên hoạt động.

**Không được xóa file ngay sau khi gửi tin Zalo.** URL cần thời gian cho Zalo lấy ảnh và người nhận tải file. Sau 24 giờ, link phải hết hạn và object được xóa.

## 2. Phạm vi áp dụng

Áp dụng cho **file tạm** do backend tạo hoặc cần chuyển tiếp qua Zalo:
- Ảnh AI tạo (`generate_image`), ảnh AI chỉnh sửa (`edit_image`), ảnh/screenshot được xử lý.
- PDF, Excel, Word, PowerPoint và ZIP đầu ra.
- Audio/voice, video đã xử lý; file đính kèm Gmail nếu người dùng yêu cầu xuất/chuyển tiếp.
- Ảnh/file đầu vào được tải từ Zalo **khi cần** lưu tạm cho một tác vụ.

Không xóa:
- File nguồn trên Gmail, GitHub, các dịch vụ của người dùng.
- Các tài nguyên ngoài bucket tạm đã tạo.
- File được lưu trong một storage provider khác theo mục đích lâu dài nếu có và không nằm trong scope của `TemporaryStorageService`.
- Conversation, Gmail data, task, Memory trong PostgreSQL (trừ nội dung/đường dẫn nhạy cảm đã hết hạn theo policy).

Nếu một ảnh cũ đã quá 24 giờ mà người dùng nói "chỉnh tiếp ảnh lúc nãy", agent phải yêu cầu gửi lại ảnh / tạo ảnh mới, không khẳng định còn file.

## 3. Hạ tầng & cấu hình tối giản

Chỉ thêm các biến **thực sự cần thiết** vào `.env.example`:

```dotenv
# Supabase chỉ dùng để lưu file tạm; PostgreSQL vẫn là DB hiện tại
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_KEY
SUPABASE_STORAGE_BUCKET=agent-temp
```

- `SUPABASE_STORAGE_BUCKET` có default `agent-temp`, có thể bỏ khỏi `.env` nếu dùng default.
- TTL **cố định trong code: 24 giờ** (`24 * 60 * 60 * 1000`), không cần `TEMP_FILE_TTL_HOURS` trong env.
- Lịch quét khôi phục do code định nghĩa, không cần thêm nhiều biến cấu hình.
- Không yêu cầu Firebase, R2 hoặc tài khoản thanh toán.
- Giữ `DATABASE_URL` và Redis config của dự án hiện tại.
- Kiểm tra phiên bản SDK `@supabase/supabase-js` và key server đúng theo tài liệu Supabase. Nếu dự án dùng Supabase Secret Key dạng mới thay vì legacy service role, cần hỗ trợ cấu hình backend tương thích và ghi rõ, **không** hardcode key.
- Secrets chỉ dùng trong NestJS server/worker, không trả về Zalo, không embed vào signed URL dưới dạng key, không log hoặc commit.

Tạo script `npm run storage:setup` hoặc tích hợp setup hiện có để kiểm tra kết nối và tạo/kiểm tra bucket PRIVATE (chỉ khi đủ quyền, không tự thay đổi bucket của người dùng). Hướng dẫn thao tác thủ công trong Supabase Dashboard nếu script không đủ quyền. Test chỉ dùng mock, không gọi thật mặc định.

## 4. Supabase Storage Adapter

Cài `@supabase/supabase-js` tương thích project và xây module NestJS chuyên trách. Ví dụ tên (ưu tiên tên hiện có nếu đã có):

```text
src/modules/storage/
  storage.module.ts
  supabase-storage.client.ts
  temporary-storage.service.ts
  temporary-file-cleanup.processor.ts
  temporary-file-sweeper.service.ts
  temporary-storage.types.ts
```

Định nghĩa contract tập trung (có thể chỉnh cho phù hợp codebase):

```ts
interface TemporaryFileResult {
  fileId: string;
  bucket: string;
  objectPath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  expiresAt: Date;
}

interface TemporaryStorageService {
  uploadTemporaryFile(input: {
    file: Buffer | Uint8Array | NodeJS.ReadableStream;
    filename: string;
    mimeType: string;
    ownerId: string;
    conversationId?: string;
    taskId?: string;
  }): Promise<TemporaryFileResult>;

  createTemporaryDownloadUrl(fileId: string, actorContext: unknown): Promise<string>;
  deleteExpiredFile(fileId: string): Promise<void>;
  sweepExpiredFiles(): Promise<void>;
}
```

**Security & file integrity**:
- Bucket phải là **private**, không cho public listing.
- Đặt object key khó đoán và không trùng, ví dụ `temp/{ownerId}/{yyyy}/{mm}/{uuid}.{ext}`; sanitize ownerId và filename, không tin vào filename gửi lên.
- Check file size theo quota thực tế của Supabase project; MIME, magic bytes khi có thể, allowlist theo nhu cầu; chống path traversal và SSRF khi lấy file từ URL ngoài.
- `upsert: false` tránh ghi đè.
- `contentType` đúng, có thể set download filename khi tạo signed URL.
- Không giữ một file Buffer quá lớn trong RAM nếu có streaming/temporary disk approach phù hợp; dọn thư mục file tạm local sau upload hoặc khi task lỗi.
- Có timeout, retry giới hạn, structured errors và logging đã redact URL nhạy cảm.
- Mọi thao tác `upload`, `createSignedUrl`, `remove` dùng **Supabase Storage API chính thức**; **không DELETE SQL trong `storage.objects`**.

## 5. PostgreSQL metadata & trạng thái

Dùng Prisma trong DB hiện tại. Tìm model `files`/`file_assets` hiện có để mở rộng, tránh tạo trùng. Nếu chưa có, tạo `temporary_files` (tên tùy convention):

```text
id: uuid / cuid (PK)
ownerId: string
conversationId: string? 
taskId: string?
bucket: string
objectPath: string UNIQUE
originalFilename: string
mimeType: string
sizeBytes: bigint/int
uploadedAt: timestamptz
expiresAt: timestamptz
status: UPLOADING | ACTIVE | DELETING | DELETED | DELETE_FAILED
lastDeleteAttemptAt: timestamptz?
deleteAttemptCount: int default 0
deletedAt: timestamptz?
lastErrorCode: string?
createdAt, updatedAt
```

- Tạo Prisma migration + index `(status, expiresAt)`.
- Chỉ đặt `ACTIVE` sau khi object upload thành công. `uploadedAt = thời điểm thực tế upload hoàn tất`, `expiresAt = uploadedAt + 24 giờ` tính theo UTC, không phụ thuộc timezone server.
- DB metadata là **source of truth** cho TTL, tránh chỉ dựa vào BullMQ job.
- Không lưu signed URL lâu dài trong database (URL được tạo theo yêu cầu và hết hạn).
- Không log toàn bộ file content, signed URL hay secrets.
- Khi upload Storage thành công nhưng ghi DB thất bại: cố gắng xóa object vừa upload; nếu cleanup cũng lỗi, ghi log đủ object key và xử lý orphan reconciliation an toàn.
- Khi DB record được tạo nhưng upload lỗi: đánh dấu failure/cleanup, không trả link giả.

## 6. Xóa sau 24h — đúng từng file (quan trọng nhất)

**Không dùng lịch 0h hằng ngày để quyết định hạn xóa.**

Ví dụ:
- File A upload thành công ngày 29/10 lúc 09:00 → `expiresAt = 30/10 09:00`.
- File B upload thành công ngày 29/10 lúc 23:40 → `expiresAt = 30/10 23:40`.

Triển khai hai lớp:

### Lớp A — BullMQ delayed deletion (chính)

Ngay khi file thành `ACTIVE`, thêm job `delete-temporary-file`:

```ts
await temporaryFileQueue.add(
  'delete-temporary-file',
  { fileId },
  {
    jobId: `temp-delete-${fileId}`,
    delay: Math.max(0, expiresAt.getTime() - Date.now()),
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
  },
);
```

- Dùng cơ chế enqueue phù hợp BullMQ phiên bản hiện tại.
- Trước khi xóa luôn load DB record và kiểm tra `expiresAt <= now` và `status` hợp lệ.
- Idempotent: hai worker chạy song song không làm xóa nhầm file khác hoặc xóa trùng gây lỗi dài hạn. Sử dụng atomic claim/transaction/locking phù hợp PostgreSQL.
- Nếu object đã không còn tồn tại: coi là đã xóa sau khi xác minh tình trạng 404/Not Found, sau đó cập nhật record.
- Nếu Supabase lỗi tạm thời: retry, `DELETE_FAILED` và giữ metadata để xử lý tiếp.
- Không đánh dấu `DELETED` trước khi xác nhận Storage đã xóa.
- Không trả signed URL cho file `DELETING`, `DELETED`, `DELETE_FAILED` hoặc đã quá `expiresAt`.

### Lớp B — Recovery sweeper (bắt buộc)

Có recurring cleanup/quét DB **mỗi 5 phút** và quét khi worker khởi động:
- Tìm `ACTIVE`/`DELETE_FAILED` với `expiresAt <= now`.
- Enqueue lại cleanup idempotently (tránh enqueue trùng).
- Xử lý trường hợp Redis mất job, worker restart, Redis bị reset hoặc lúc upload chưa enqueue được.
- Có cursor/pagination, giới hạn batch, không scan vô hạn.
- Nếu chạy nhiều replicas, dùng distributed lock/unique repeat scheduling để tránh duplicate sweep; vẫn phải idempotent.
- Nếu worker offline tại mốc 24h, xóa khi worker chạy lại; **không cam kết chính xác từng giây** khi hệ thống tắt hoặc queue quá tải.
- Chạy sweep lần đầu khi app/worker start, không để chờ cron đầu tiên.

Có thể thêm lệnh quản trị (OWNER hoặc CLI-only):

```text
npm run storage:cleanup
npm run storage:check
```

`cleanup` chỉ xóa object đã hết hạn trong bucket tạm, tuyệt đối không xóa toàn bộ bucket.

## 7. URL tải file & khả năng tương thích Zalo

### File tài liệu (PDF/Excel/Word/ZIP/video)
- Tạo **signed download URL** qua Supabase Storage API, không public bucket.
- Thời hạn URL **không được vượt** thời gian sống còn lại của file. Ví dụ:

```ts
const secondsRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
if (secondsRemaining <= 0) throw new FileExpiredError();
const expiresIn = Math.max(1, Math.min(secondsRemaining, 24 * 60 * 60));
```

- Có khả năng signed URL sẽ ngừng hoạt động sau 24h vì object bị xóa, dù phía ứng dụng/chat vẫn hiển thị link.
- Khi gửi link qua Zalo, nói rõ "Link tải có hiệu lực trong 24 giờ kể từ lúc file được tạo" (hoặc số giờ còn lại nếu đã được lưu một lúc).
- Không giả định Zalo Official Bot hỗ trợ gửi document/video trực tiếp; giữ cơ chế gửi **link** nếu method thực tế không hỗ trợ.
- Nếu người dùng xin lại link trước khi hết hạn: kiểm tra quyền, tạo signed URL mới chỉ với thời gian còn lại.

### Ảnh gửi bằng `sendPhoto`
- Tạo signed URL tải được qua HTTPS để máy chủ Zalo có thể fetch.
- Gửi ảnh bằng `zalo-bot-js` hiện có; xác minh API phản hồi và log kết quả.
- **Không xóa object ngay khi `sendPhoto` trả OK**; vẫn giữ 24 giờ.
- Link signed cho Zalo có thể ngắn hơn TTL file (ví dụ 1 giờ, hoặc thời gian còn lại) miễn đủ thời gian Zalo tải về; test thực tế. Không cho ảnh nhạy cảm public vĩnh viễn.
- Ghi rõ trong tài liệu: việc Zalo lưu/cache ảnh sau khi gửi tùy nền tảng, không cam kết ảnh trong tin nhắn vẫn tải được sau khi object xóa nếu Zalo còn phụ thuộc URL nguồn.

### Vision/Image Editing
- Khi LLM cần đọc ảnh đã lưu: dùng signed URL hợp lệ/bytes phù hợp với API OpenRouter; không đưa URL đã hết hạn.
- Tiếp nối việc sửa ảnh chỉ được thực hiện khi asset còn hạn; nếu hết hạn, yêu cầu gửi lại.

## 8. Tích hợp với Zalo Agent hiện tại

Tìm tất cả nơi đang gọi R2/Firebase/local-public-storage/Supabase cũ hoặc tự dựng URL. Chuyển sang `TemporaryStorageService`, ưu tiên giữ một interface `StorageService` chung cho Agent Tools.

Phải tương thích:
- `generate_image`, `edit_image`, `analyze_image`.
- `create_excel`, `create_pdf`, `create_word`, các tool xuất báo cáo.
- Gmail attachment export.
- Zalo photo/file delivery.
- Task results, progress messages.
- Conversation media attachment references.
- Owner/Public/Group permission policy.

**Quyền riêng tư**:
- Owner có thể tạo và nhận tài liệu riêng trong chat 1:1.
- Public/group chỉ nhận file họ được phép tạo/truy cập; không thể xin URL file Owner, kể cả đoán `fileId`.
- Link trong nhóm là bearer URL: bất cứ ai có link có thể tải trong thời gian hiệu lực. Không tự gửi tài liệu nhạy cảm của Owner vào nhóm.
- Không tin vào userId hoặc ownerId do LLM tự tạo trong tool arguments; lấy actor context đã xác thực từ backend.

**Phản hồi tiến độ**:
- ACK khi bắt đầu tạo file.
- Cập nhật "Đã tạo file, em đang tải lên để gửi anh ạ" khi có bước thật.
- Chỉ gửi "Đã xong" sau khi upload và trả về Zalo thành công.
- Nếu lỗi storage hoặc quá quota: báo lỗi ngắn gọn, không gửi URL giả; không im lặng.

## 9. Bỏ R2/Firebase an toàn

- Kiểm tra xem có R2 client/bucket config/Firebase Storage adapter cũ hay không.
- Đổi tích hợp đầu ra sang Supabase; chỉ remove dependencies/env/config cũ **sau khi code đã chuyển và test đạt**.
- Không tự xóa file cũ trên cloud hay dữ liệu cũ của người dùng.
- Nếu dữ liệu đã có trong R2/Firebase, báo rõ các file cũ không được migrate tự động và không xóa chúng.
- Không phá vỡ interface tool hoặc import hiện tại.

## 10. Automated tests (phải viết và chạy)

Kiểm thử với mock Supabase, mock Queue, fake clock:

1. Upload thành công → có object + record `ACTIVE` + `expiresAt = uploadedAt + 24h`.
2. Upload thất bại → không trả URL, không để record ACTIVE sai.
3. Storage upload thành công nhưng DB ghi lỗi → bù trừ/xóa object hoặc ghi cảnh báo orphan.
4. Sau 23h59m → **không xóa**.
5. Đúng mốc 24h/đến hạn → delete Storage + mark `DELETED`.
6. Xóa lỗi tạm → retry, không mất metadata.
7. Worker bị restart trước deadline → delayed job/sweeper xử lý lại.
8. Redis mất delayed job → sweeper tìm và xử lý.
9. Hai worker nhận cùng file → chỉ xử lý xóa an toàn một lần.
10. File quá hạn → không cấp signed URL mới.
11. URL được tạo có TTL không vượt thời gian sống còn lại.
12. User khác không thể lấy link file Owner.
13. Group không nhận file cá nhân Owner.
14. Zalo `sendPhoto` lỗi → không báo đã gửi, vẫn cleanup về sau.
15. Tạo Excel/PDF/ảnh đầu ra → upload → trả signed link / gọi SDK Zalo qua mock.
16. Không xóa file ngoài bucket/path tạm.
17. Local temp files được dọn sau xử lý và khi xảy ra lỗi.

Tạo optional smoke/integration tests có thể chạy khi user đã nhập credentials, không gọi Supabase thật trong unit tests mặc định.

## 11. Tài liệu & scripts phải bàn giao

Cập nhật/tạo:

```text
.env.example
README.md
docs/SUPABASE_TEMP_STORAGE.md
docs/DEPLOYMENT.md
IMPLEMENTATION_STATUS.md
```

Tài liệu setup phải đủ cụ thể:
1. Đăng ký Supabase Free (nếu project chưa có).
2. Tạo Supabase project; **không** cần dùng Supabase Database cho NestJS.
3. Tạo bucket `agent-temp`, cấu hình PRIVATE.
4. Lấy Project URL và secret/service-role key phía server.
5. Nhập `.env`.
6. Chạy migration PostgreSQL hiện tại.
7. Start NestJS API + Redis + BullMQ worker.
8. Dùng Zalo yêu cầu tạo thử một file Excel và một ảnh.
9. Test download link thật (có hạn), kiểm tra event xử lý thành công.
10. Cách test TTL trong môi trường **test database/test bucket** bằng fake clock hoặc expiry rút ngắn trong test fixture, **không đổi TTL 24h production**.
11. Cách quan sát queue, cleanup logs, retry và lỗi Storage.

Đưa thêm một bảng trạng thái module: `DONE`, `IMPLEMENTED_NOT_LIVE_TESTED`, `BLOCKED_BY_CREDENTIALS`, `PARTIAL`.

## 12. Acceptance criteria

Coi là hoàn thành khi:
- Không còn phụ thuộc R2/Firebase trong luồng upload/gửi file mới.
- Supabase private bucket được sử dụng cho file tạm.
- PostgreSQL vẫn là database hiện tại, Redis/BullMQ vẫn giữ nguyên.
- Từng file có `expiresAt` riêng = **24 giờ sau upload thành công**.
- BullMQ tự xóa khi đến hạn; sweeper định kỳ và khi khởi động cứu job bị mất.
- Supabase object thực sự được xóa, không chỉ xóa metadata DB.
- Người dùng nhận được ảnh/link tải qua Zalo; link không còn hợp lệ sau khi file hết hạn.
- Không lộ API key; không cho người khác truy cập tài liệu riêng.
- Có unit tests, migration, README, logs, script setup/check/cleanup.
- Build, lint, typecheck, tests chạy đạt; nếu thiếu credentials thì ghi `IMPLEMENTED_NOT_LIVE_TESTED`, không giả khẳng định đã kiểm thử live.

**Thực hiện ngay trong workspace hiện tại. Bắt đầu bằng kiểm tra code storage đang dùng, sau đó refactor và triển khai đến khi có một luồng end-to-end chạy được. Không tạo dự án NestJS mới và không dừng ở việc mô tả kế hoạch.**

---

## Tài liệu chính thức để kiểm tra khi code

- Supabase Storage upload: https://supabase.com/docs/reference/javascript/file-buckets-upload
- Supabase signed URL: https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl
- Supabase remove: https://supabase.com/docs/reference/javascript/file-buckets-remove
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- BullMQ delayed jobs: https://docs.bullmq.io/guide/jobs/delayed
- NestJS scheduling: https://docs.nestjs.com/techniques/task-scheduling
