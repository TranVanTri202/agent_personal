# Báo Cáo Rà Soát (Audit & Root-Cause Analysis) — Context Intelligence & Media Execution

## 1. Tóm tắt vấn đề cốt lõi (Core Problem)
Hành vi lỗi thực tế được báo cáo:
1. Người dùng gửi một hình ảnh vào Zalo Bot; bot thông báo đã nhận và lưu hình ảnh.
2. Người dùng hỏi: **"Ảnh đó có thông tin gì? Gửi lại coi."**
3. Bot tự ý suy đoán và mô tả "ảnh con mèo chibi màu trắng đang nằm ngủ" từ ngữ cảnh cũ, **hoàn toàn không phân tích bức ảnh thực tế vừa nhận và cũng không thực hiện gửi lại ảnh**.

---

## 2. Bằng chứng kiểm tra mã nguồn (Evidence from Codebase)

### 2.1. Tiếp nhận và lưu trữ Media (`Zalo Incoming Event -> Ingestion`)
- **Vị trí:** `src/modules/zalo/zalo-event.normalizer.ts` (dòng 65-70) và `src/modules/agent/agent.service.ts` (dòng 156-167).
- **Hiện trạng:**
  - `ZaloEventNormalizer` trích xuất `imageUrl` vào mảng `attachments: [{ type: 'IMAGE', sourceUrl: '...' }]`.
  - `agent.service.ts` lưu `Message` với `content: ""` (hoặc rỗng nếu không có caption) và `type: MessageType.IMAGE`.
  - `imageContextService.recordIncomingUserImage` tải ảnh về và gọi `storageService.saveFile(...)`.
- **Lỗ hổng phát hiện:**
  1. `recordIncomingUserImage` nhận `params.conversationId` nhưng không chuyển `conversationId` vào `storageService.saveFile()`. Dẫn đến `StoredFile.conversationId` bị `null`, không thể truy vấn ngược ảnh nào thuộc conversation nào từ database!
  2. `StoredFile` được lưu nhưng ID của nó không được cập nhật ngược lại vào `Message.attachmentsJson` hay `Message.metadataJson`.
  3. `imageContextService` lưu cache trong `Map<string, RecentImageRecord>()` trên RAM; khi worker restart, toàn bộ liên kết ảnh người dùng gửi gần nhất bị mất sạch.
  4. `ZaloEventNormalizer` chưa trích xuất `replyToMessageId` từ tin nhắn quote/reply của Zalo SDK.

### 2.2. Lắp ráp ngữ cảnh hội thoại (`Context Retrieval -> Prompt Assembly`)
- **Vị trí:** `src/modules/agent/agent.service.ts` (dòng 784-789) và `src/modules/conversation-intelligence/context-resolver.service.ts`.
- **Hiện trạng:**
  - Vòng lặp lấy `recentHistory` chỉ nạp trường `content` (chuỗi text đơn thuần) vào `messages`:
    ```ts
    messages.push({
      role: h.direction === MessageDirection.INBOUND ? 'user' : 'assistant',
      content: h.content, // Rỗng nếu là tin nhắn ảnh!
    });
    ```
  - Hoàn toàn KHÔNG truyền cấu trúc multimodal (`image_url` hay block đa phương tiện) sang OpenRouter.
  - `ContextResolverService` khi gặp từ khóa "ảnh" chỉ tiêm một dòng prompt tĩnh:
    `- Ảnh gần nhất trong cuộc trò chuyện có File/Image ID: "${resolvedImageId}". Khi edit_image có thể sử dụng ảnh này.`
  - Không có hướng dẫn hoặc cơ chế giải quyết khi người dùng hỏi nội dung ảnh ("ảnh đó có thông tin gì") hoặc yêu cầu gửi lại ảnh ("gửi lại coi").

### 2.3. Thiếu vắng Tool phân tích & Gửi lại Media (`Missing Core Tools`)
- **Vị trí:** `src/modules/tools/impl/image.tools.ts` và `src/modules/tools/tool.registry.ts`.
- **Hiện trạng:**
  - Hệ thống chỉ có 2 tool liên quan đến ảnh: `generate_image` và `edit_image`.
  - **HOÀN TOÀN KHÔNG CÓ** tool:
    - `analyze_existing_image`: đọc ảnh từ Storage/Supabase, kiểm tra TTL, truyền dữ liệu vision hoặc trích xuất thông tin.
    - `resend_existing_media`: nhận `mediaId` đã resolve, kiểm tra quyền và file khả dụng (chưa hết hạn 24h), gọi `sendPhoto` hoặc `sendFileLink` thật qua Zalo API.
    - `get_recent_media`: liệt kê danh sách media trong hội thoại kèm trạng thái.
  - Vì không có tool gửi lại ảnh và không có tool phân tích ảnh, LLM buộc phải "tự bịa" nội dung dựa trên topic hoặc mô tả trước đó (con mèo chibi) và không thể gửi lại ảnh cho người dùng.

### 2.4. Phân rã đa ý định (`Multi-Intent Recognition`)
- **Vị trí:** `src/modules/agent/agent.service.ts`.
- **Hiện trạng:**
  - Câu lệnh phức: *"Ảnh đó có thông tin gì? Gửi lại coi."* chứa 2 ý định:
    1. `analyze_image`: phân tích nội dung hình ảnh.
    2. `resend_existing_media`: gửi lại bức ảnh đó về chat Zalo.
  - Hệ thống hiện tại không có bộ phân rã ý định (`PlanAction`), phó mặc toàn bộ cho 1 lượt LLM prompt đơn tuyến. Nếu model không hỗ trợ vision (như `openrouter/free`), lỗi capability văng ra hoặc model bỏ qua hoàn toàn hành động gửi ảnh.

### 2.5. Trạng thái vòng đời 24h (`Temporary Storage TTL`)
- **Vị trí:** `src/modules/storage/temporary-storage.service.ts`.
- **Hiện trạng:**
  - Files được lưu tạm 24 giờ trên Supabase / Local Storage.
  - Khi file bị xóa sau 24h (`status: DELETED`), database vẫn lưu metadata. Tuy nhiên context resolver không kiểm tra trạng thái `status === 'ACTIVE'` trước khi trả về `resolvedImageId`, dẫn đến việc có thể tham chiếu vào file đã hết hạn mà không báo rõ cho người dùng.

### 2.6. Lệnh `/clear` chưa được triển khai
- **Vị trí:** `src/modules/agent/agent.service.ts` (`handleCommand`).
- **Hiện trạng:**
  - Chưa có lệnh `/clear`. Người dùng không thể đặt lại ngữ cảnh hội thoại khi muốn bắt đầu chủ đề mới hoặc khi ngữ cảnh cũ bị ô nhiễm.

---

## 3. Kế hoạch khắc phục tận gốc (Remediation Plan)

1. **Chuẩn hóa Data Model & Ingestion:**
   - Đảm bảo `StoredFile` lưu `conversationId`, `source` (`incoming` / `generated` / `edited`), và liên kết với `Message.attachmentsJson`.
   - Lưu trữ metadata phân tích (`analysisSummary`, `analysisModel`, `analysisCreatedAt`) trên `StoredFile`.
   - Trích xuất `replyToMessageId` trong `ZaloEventNormalizer`.
2. **Context Resolver thông minh:**
   - Mở rộng `ContextResolverService` trả về `ResolvedReference` có `kind`, `entityId`, `confidence`, `reason`.
   - Ưu tiên: `replyToMessageId` -> file đính kèm tin hiện tại -> output của assistant gần nhất -> file người dùng gửi gần nhất -> số thứ tự.
   - Cô lập triệt để giữa chat 1-1 và Group.
3. **Triển khai các Tool bắt buộc:**
   - `resend_existing_media`: Gửi lại ảnh/file thật qua Zalo SDK, kiểm tra TTL và kết quả xác thực.
   - `analyze_existing_image`: Đọc ảnh thật, gọi vision capability (hoặc multimodal), lưu cache tóm tắt, nếu model không hỗ trợ vision thì báo rõ ràng, không bịa.
   - `get_recent_media`: Lấy danh sách media của hội thoại kèm trạng thái còn hạn/hết hạn.
4. **Multi-Intent Planning & Partial Success:**
   - Cho phép xử lý độc lập: Nếu vision thất bại do model không hỗ trợ, vẫn thực hiện `resend_existing_media` thành công.
5. **Lệnh `/clear`:**
   - Xử lý tại tầng command dispatcher, reset conversation state, active references, Redis cache mà không làm mất reminders, tài khoản email hay file vật lý 24h.
