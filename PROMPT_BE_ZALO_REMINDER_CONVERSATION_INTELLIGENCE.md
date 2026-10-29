# MASTER IMPLEMENTATION PROMPT — ZALO PERSONAL AI AGENT
## Fix reminder không gửi sau 10 phút + Conversation Intelligence (NestJS)

> **Dành cho AI Coding Agent trong VS Code.** Hãy đọc toàn bộ nội dung này, kiểm tra repository hiện tại và **triển khai code thực tế**. Không tạo một ứng dụng mới, không chỉ đưa thiết kế hoặc pseudocode.

## 0. Bối cảnh dự án

Dự án hiện tại là **Zalo Personal AI Agent**:

- Backend **NestJS / TypeScript**, dùng **Zalo Official Bot** và có thể đã chuyển sang SDK [`KaiyoDev/zalo-bot-js`](https://github.com/KaiyoDev/zalo-bot-js); kiểm tra code thật, không giả định.
- Đang phát triển trên **localhost**, nhận tin nhắn bằng **long polling**; production có thể chuyển webhook.
- **PostgreSQL + Prisma**, **Redis + BullMQ**, có worker xử lý tác vụ bất đồng bộ.
- **OpenRouter** làm LLM provider, đã có chế độ `single` hoặc `task` routing; **không phá vỡ** cơ chế đang hoạt động.
- Có/đang xây các tool: Gmail, tạo file, Memory, hình ảnh, Sticker, Scheduler, phê duyệt, R2.
- Owner được dùng các công cụ và dữ liệu cá nhân trong chat riêng. Người khác có thể chat công khai; không được truy cập Gmail, cấu hình, Memory riêng của Owner. Group cũng phải cách ly dữ liệu.
- Bot xưng **em**, nói chuyện **dạ/vâng**, tự nhiên, có chút hóm hỉnh đúng lúc; nghiêm túc khi làm việc và khi xảy ra lỗi.
- **Hạn chế thêm biến `.env`**. Tận dụng biến kết nối PostgreSQL/Redis/Zalo/LLM đã có. Các quy tắc chung đặt bằng code/config nội bộ với mặc định hợp lý.
- Không có Playwright và không yêu cầu VPS để chạy local.

### Vấn đề cần sửa NGAY

Người dùng nhắn:

> "10 phút nữa kêu tôi làm việc" / "10 phút nữa nhắc anh làm việc"

Bot có thể trả lời "Dạ em sẽ nhắc" nhưng **10 phút sau im lặng**. Đây là lỗi nghiêm trọng: hứa thực hiện nhưng không tạo lịch, không enqueue, worker không chạy, send lỗi, hoặc trạng thái không được phục hồi.

**Đích:** Khi tạo reminder thành công, backend phải thực sự tự gửi Zalo vào đúng cuộc chat khi đến hạn, **không cần người dùng nhắn tiếp và không cần một LLM request mới để kích hoạt**.

---

# PHẦN A — RELIABLE REMINDER / PROACTIVE NOTIFICATION

## A1. Audit source hiện tại trước khi sửa

1. Tìm toàn bộ code liên quan: `reminder`, `schedule_task`, `scheduled_jobs`, `@nestjs/bullmq`, `BullMQ`, `Worker`, `Queue`, cron, notifications, `sendMessage`, `ZaloChannelAdapter`, tool registry, event handlers, owner permissions.
2. Truy vết từ **tin nhắn Zalo → LLM tool call → tool executor → database → queue → worker → gửi Zalo**.
3. Xác định nguyên nhân cụ thể vì sao lời nhắc "10 phút nữa" không gửi; có thể là chưa tạo job, worker không khởi động, wrong queue name, giờ bị tính sai, thiếu recipient chat ID, Redis chưa chạy, delayed job bị kẹt, permission guard chặn nhầm, process bị chết hoặc lệnh bị AI trả lời bằng chữ thay vì tool call.
4. Giữ lại những thành phần đã đúng, **không tạo một Scheduler thứ hai chạy song song** và không làm mất dữ liệu.
5. Ghi ngắn gọn trong `docs/REMINDER_TROUBLESHOOTING.md` nguyên nhân đã tìm thấy, cách khắc phục và cách tự kiểm tra.

## A2. Hành vi đầu cuối bắt buộc

Ví dụ user nhắn lúc 09:00:00 (Asia/Ho_Chi_Minh):

**User:** `10 phút nữa nhắc anh làm việc`

**Bot sau khi đã lưu lịch thành công:**

> Dạ vâng ạ! Em đã đặt lời nhắc **làm việc** lúc **09:10** rồi nhé ⏰

Đến khoảng 09:10, worker chủ động gửi về chat đã được phép nhận:

> ⏰ Anh ơi, đến giờ **làm việc** rồi ạ! Chiến thôi anh 😄

Yêu cầu:

- Lấy `receivedAt` từ thời điểm backend thực sự nhận message, dùng làm mốc cho thời gian tương đối; tính toán bằng code, không giao LLM tự quyết định timestamp cuối cùng.
- Lưu **UTC timestamp** trong PostgreSQL, hiển thị theo `Asia/Ho_Chi_Minh` (dùng timezone cấu hình hiện có nếu đã có).
- `10 phút nữa` = `receivedAt + 10 * 60 * 1000` ms. Không làm tròn sang đầu phút kế tiếp khi không cần.
- ACK **chỉ** được nói "đã đặt" nếu database và trạng thái enqueue đã được xác nhận; nếu có lỗi phải báo rõ chưa đặt thành công.
- Tên việc là `làm việc`, không tự đổi thành một hành động khác.
- Không cần user đang online hoặc nhắn thêm.
- Nếu **máy chạy bot/worker tắt**, không thể gửi đúng giờ. Khi bật lại, hệ thống phải phát hiện reminder quá hạn, áp dụng chính sách phục hồi và báo minh bạch "Lời nhắc bị trễ do hệ thống tạm ngừng" thay vì gửi như thể đúng giờ.
- Mặc định chỉ gửi private reminders vào cuộc chat riêng của đúng user. Không công khai reminder/dữ liệu Owner vào nhóm.

## A3. Reminder tool phải thực thi thật

Cung cấp các tools cho Agent Runtime (tên có thể theo convention hiện tại):

```text
create_reminder
list_reminders
get_reminder
cancel_reminder
reschedule_reminder
```

Tool `create_reminder` phải nhận dữ liệu chuẩn hóa/typed, ví dụ:

```ts
interface CreateReminderInput {
  title: string;
  dueAt: string; // ISO 8601 with offset, OR normalized absolute UTC
  note?: string;
}
```

**Không để model tự đưa `userId`, `chatId`, `role`, `isOwner` để kiểm soát quyền**. Các giá trị này bắt buộc lấy từ trusted `ToolExecutionContext` do backend tạo từ event Zalo đã xác minh.

Khi gọi tool:

1. Validate schema, deadline trong tương lai, giới hạn hợp lý (không chấp nhận ngày vô nghĩa).
2. Kiểm tra quyền của sender và chat scope.
3. Ghi reminder vào PostgreSQL, có `id`, `ownerUserId`, `recipientChannel`, `recipientChatId`, `title`, `dueAt`, `status`, `createdAt`, `updatedAt`, `revision`, `sentAt`, `lastError`.
4. Tạo delayed job BullMQ tới thời điểm cần gửi. Job ID có tính định danh, ví dụ `reminder:<id>:<revision>` (kiểm tra quy định ký tự `jobId` của BullMQ phiên bản cài trong dự án; tránh ký tự bị cấm, có thể dùng dấu gạch ngang).
5. Chỉ sau khi enqueue thực sự thành công mới ACK "đã đặt". Nếu PostgreSQL đã lưu nhưng Redis enqueue lỗi, giữ trạng thái `PENDING_ENQUEUE`, tự phục hồi bằng reconciliation và **không nói sai** rằng đã hoạt động bình thường; có thể báo "em đã ghi nhận, nhưng hệ thống lên lịch đang lỗi, em sẽ thông báo lại sau khi khôi phục".
6. Trả về structured tool result chứa `id`, `dueAt`, `status`, `title` để LLM tạo câu xác nhận đúng.

**Tuyệt đối không** dùng `setTimeout(600000)` nằm trong NestJS HTTP listener hoặc trong LLM request để làm lịch chính. Khi Node process restart sẽ mất timer.

## A4. BullMQ worker phải thật sự chạy

- Kiểm tra package versions và dùng API BullMQ thích hợp.
- Đối với one-time reminder dùng **delayed job** (`delay = Math.max(0, dueAt - Date.now())`).
- Đối với recurring schedules dùng **Job Schedulers** (`upsertJobScheduler`) nếu version hỗ trợ; **không nhầm việc nhắc một lần với cron**, không sử dụng API repeatable cũ đã deprecated ở phiên bản mới.
- Worker phải được đăng ký ở module/process đang chạy thật, đúng tên queue, connection, prefix và Redis namespace.
- Không chạy hai independent polling instances của cùng một Zalo Bot; nhưng có thể chạy worker riêng không polling.
- Có lifecycle logs: `REMINDER_CREATED`, `ENQUEUED`, `DUE`, `SENDING`, `SENT`, `FAILED`, `RETRYING`, `CANCELLED`.
- Retry transient errors với exponential backoff, có maximum attempts. Phân loại lỗi API permanent và temporary.
- Worker không cần gọi LLM khi đến giờ; dùng nội dung reminder được lưu + template tự nhiên. Không phụ thuộc OpenRouter đang hoạt động để nhắc việc.
- Dùng SDK Zalo đang tích hợp (`sendMessage` qua `ZaloChannelAdapter`); **không tự tạo lại bot client/token hoặc listener độc lập**.
- Chỉ đánh dấu `SENT` sau khi Zalo API/SDK trả xác nhận thành công theo contract thực tế.

## A5. Trạng thái bền vững và phục hồi

PostgreSQL là **nguồn dữ liệu chính cho reminder**; Redis/BullMQ là execution queue.

- Hỗ trợ restart API, worker, Redis mà không làm mất reminder đã commit vào DB.
- Bật Redis persistence trong docker-compose local nếu chưa có, đảm bảo volume phù hợp.
- Dùng một transaction/outbox/reconciliation pattern hợp lý để xử lý chênh lệch giữa việc save DB và enqueue Redis; giải thích lựa chọn.
- On startup và theo chu kỳ kiểm tra những reminder `PENDING_ENQUEUE`/`SCHEDULED` mà queue job bị thiếu, enqueue lại idempotently.
- Khi tới hạn, dùng transaction/row lock hoặc conditional update để chỉ một worker claim được một reminder revision.
- Job cũ của reminder đã bị hủy/dời lịch phải trở nên vô hiệu; worker luôn reload DB, kiểm tra `status`, `revision`, `dueAt` trước khi gửi.
- Khi hủy, đánh dấu DB trước, rồi best-effort remove job; DB state là thẩm quyền cuối cùng.
- Khi thay đổi thời gian, tăng revision, enqueue job mới và làm vô hiệu job cũ.
- Có xử lý worker chết trong trạng thái `SENDING`: lease/claim timeout + recover và audit.
- Thiết kế **at-least-once** thực tế và hạn chế gửi lặp. Vì nếu Zalo đã nhận nhưng backend timeout trước khi lưu kết quả, không thể khẳng định exactly-once nếu API không hỗ trợ idempotency key. Không hứa đảm bảo exactly-once tuyệt đối.
- Có danh sách `FAILED` và khả năng retry có kiểm soát, không xóa mất lịch hỏng.
- Late reminders: khi hồi phục sau thời điểm hẹn, gửi cảnh báo nhắc trễ với thời gian gốc (nếu phù hợp) thay vì âm thầm bỏ qua; có chính sách riêng cho lịch quá cũ và phải được thể hiện rõ trong docs.

## A6. Natural-language scheduling

Bot phải hiểu các mẫu:

- `10 phút nữa nhắc anh làm việc`
- `5p nữa báo em uống nước`
- `Nửa tiếng nữa gọi anh dậy`
- `Nhắc tôi kiểm tra mail lúc 16h`
- `Mai 8h nhắc tôi họp`
- `Thứ Hai hàng tuần lúc 9h gửi lời nhắc họp team`
- `Nhắc tôi sau 2 tiếng nữa`
- `Dời lời nhắc làm việc thêm 15 phút`
- `Thôi hủy lời nhắc vừa tạo`
- `Có những lời nhắc nào hôm nay?`

Yêu cầu:

- Phân biệt **one-time** và **recurring**.
- Dùng LLM để hiểu intent/slot nếu cần, nhưng **chuẩn hóa thời gian và validate bằng code** (có thể dùng thư viện parse time đã kiểm chứng).
- Timezone mặc định `Asia/Ho_Chi_Minh`, tránh lệch ngày khi server chạy UTC.
- Những câu thực sự mơ hồ như "lát nữa", "chiều mai", nếu không có default được người dùng chấp nhận, chỉ hỏi **một câu ngắn** để làm rõ.
- Nếu người dùng nói "dời thêm 15 phút" ngay sau khi tạo reminder, lấy đúng reminder đang active trong conversation/task context; nếu có nhiều khả năng thì hỏi chọn.
- Khi user yêu cầu cancel hoặc reschedule, gọi **tool thật**, không chỉ trả lời bằng lời.
- Nếu tool bị permission-denied, bot không được khẳng định đã tạo/hủy lịch.
- Gắn reminder vào `senderId` và private `chatId` được xác minh.

## A7. Nhắc việc trong nhóm và người dùng khác

- Các tool cá nhân của Owner như Gmail, quản trị bot, private memory, private schedules vẫn chỉ dành cho Owner chat riêng.
- Những người khác có thể trò chuyện bình thường.
- Nếu đã cho phép public reminder, chỉ được tạo **lời nhắc cho chính người gửi** trong private chat, có quota chống lạm dụng; không để người khác đặt lời nhắc gửi vào chat riêng của Owner hoặc tài khoản người khác.
- Nếu chưa có private chat hoặc chưa đủ quyền Zalo để chủ động nhắn, phải báo rõ không thể gửi reminder; đừng xác nhận đặt thành công khi không có đường gửi được.
- Trong group, mặc định không đưa nội dung personal reminders vào group. Nếu nhóm muốn reminder công khai thì cần policy riêng có kiểm duyệt và xác minh capability trước khi bật.

## A8. Commands & UX

Các lệnh (ngoài ngôn ngữ tự nhiên):

```text
/reminders               # lời nhắc sắp tới của chính người dùng
/reminder <id>           # xem chi tiết
/reminder-cancel <id>    # hủy
/reminder-test           # tạo reminder test sau khoảng 60 giây
```

Lưu ý:

- Không tạo biến `.env` mới chỉ cho tính năng reminder nếu không thực sự cần.
- Bot phản hồi ngay khi nhận yêu cầu, dùng các bước: `ACK đang xử lý` → `xác nhận lưu lịch` → `thông báo đúng giờ`.
- Dùng ACK ngắn, ví dụ: "Dạ để em đặt lời nhắc cho anh ạ...". Không nói "đã đặt" trước khi tool thành công.
- Nếu có lỗi: "Dạ em chưa đặt được lời nhắc vì bộ xử lý lịch đang lỗi, anh thử lại giúp em nhé." kèm lỗi đủ hữu ích và task ID khi có.
- Bot không được gửi thông báo tiến độ spam cho các task siêu ngắn.

---

# PHẦN B — CONVERSATION INTELLIGENCE

## B1. Mục tiêu

Làm bot tạo cảm giác **thật sự thông minh và có khả năng hành động**, không chỉ đưa câu trả lời chung chung.

4 trụ cột:

1. **Understand** — hiểu ý định, tiếng Việt tự nhiên, câu thiếu thông tin, viết tắt, từ lóng, context.
2. **Remember** — lưu ngữ cảnh đa lượt, nhớ những gì quan trọng **đúng người, đúng chat**, không lộ thông tin.
3. **Act** — chọn và thực thi tools có quyền, thực hiện workflow nhiều bước, biết hỏi khi thật sự thiếu dữ liệu.
4. **Verify** — kiểm chứng hiệu quả và công khai trạng thái thật trước khi báo thành công.

## B2. Hội thoại nhiều lượt

Hỗ trợ các tình huống:

**Ví dụ 1:**

- User: "10 phút nữa nhắc anh làm việc"
- Bot đặt lịch thật.
- User: "À dời thêm 5 phút nhé"
- Bot hiểu **lời nhắc vừa tạo**, thực hiện `reschedule_reminder`, xác nhận thời điểm mới.
- User: "Hủy đi"
- Bot hiểu đúng reminder đó, gọi tool hủy.

**Ví dụ 2:**

- User gửi ảnh chụp lỗi ứng dụng.
- User: "Lỗi này do đâu?"
- Bot phân tích **ảnh vừa gửi** nếu model/capability đang cấu hình hỗ trợ.
- User: "Tóm tắt thành PDF gửi anh"
- Bot lấy kết quả phân tích trước đó, tạo PDF và gửi link/file qua Zalo theo khả năng API.

**Ví dụ 3:**

- Owner private: "Kiểm tra 5 email mới nhất"
- Bot dùng Gmail Tool.
- User: "Cái thứ 2 soạn trả lời giúp anh"
- Bot resolve đúng email thứ hai từ danh sách trước đó và tạo draft, chưa gửi nếu chưa duyệt.

**Ví dụ 4:**

- User: "Hôm nay chán quá"
- Bot phản hồi có cảm xúc, lịch sự, nhẹ nhàng và phù hợp.
- User: "Mà 20 phút nữa nhắc anh tập trung code"
- Bot chuyển sang action scheduling, không chỉ động viên.

## B3. Structured Conversation State

Kiểm tra schema hiện có, bổ sung tối thiểu các thành phần cần thiết:

```ts
interface ConversationState {
  conversationId: string;
  userId: string;
  chatId: string;
  chatType: 'PRIVATE' | 'GROUP';
  currentTopic?: string;
  activeTaskId?: string;
  lastReminderId?: string;
  lastEmailThreadIds?: string[]; // only in Owner private scope
  lastFileIds?: string[];
  lastImageIds?: string[];
  pendingClarification?: {
    intent: string;
    missingSlots: string[];
    safeContextRef: string;
  };
  updatedAt: string;
}
```

Không bắt buộc dùng chính xác interface trên; có thể sử dụng tables/JSONB hiện tại nếu phù hợp.

**Bắt buộc:**

- State bền vững trong PostgreSQL hoặc các kho có persistence phù hợp. Không chỉ lưu biến RAM.
- Key theo đúng `(channel, chat_id, user_id, scope)` để tránh trộn 1:1, nhóm và owner private.
- Có thứ tự xử lý message theo conversation khi cần, tránh hai tin nhắn liên tiếp cập nhật state sai thứ tự.
- Khi thấy câu "cái này", "việc đó", "nó", "cái thứ 2", "dời thêm" phải thử resolve từ ngữ cảnh đã cấp quyền.
- Không lấy context của người dùng khác hoặc nhóm khác. Không đọc private owner state từ group kể cả owner là người hỏi.
- Có giới hạn lịch sử và summarization để không gửi toàn bộ chat không cần thiết lên LLM.

## B4. Memory đúng nghĩa, không lưu tràn lan

Phân biệt:

- **Short-term context:** những message gần đây, tool results, media refs, active task.
- **Episodic/task memory:** việc đã làm, kết quả, lời nhắc, email/file đã tham chiếu.
- **Long-term preferences:** ví dụ user thích cách xưng hô, ngôn ngữ, cách trình bày.

Yêu cầu:

- Cài trên memory/retrieval đã có; không tạo hệ thống memory mới song song.
- Chỉ lưu những thông tin có ích, phù hợp với quyền và có thể chỉnh/xóa.
- Tránh lưu secrets, token, raw emails hoặc dữ liệu nhạy cảm làm long-term memory nếu không cần.
- Không mặc định chia sẻ long-term memory giữa các người dùng.
- Khi user yêu cầu "đừng nhớ điều này", cần tuân theo và có workflow xóa dữ liệu do hệ thống quản lý phù hợp.
- Tool/LLM cần dùng memory sau khi đã kiểm tra authorization.

## B5. Tool-first khi user giao việc

Khi yêu cầu có hành động thực hiện được, Agent phải **ưu tiên gọi tool** hơn là nói "em sẽ làm".

Ví dụ:

- "Nhắc tôi sau 10 phút" → **create_reminder**.
- "Gửi email" → compose/draft + approval + Gmail send nếu được duyệt.
- "Tạo Excel" → generate file + upload + send.
- "Tạo ảnh" → image generation tool có capability/permission tương ứng.
- "Tóm tắt ảnh" → vision pipeline nếu model hỗ trợ.

**Không cho phép trả lời kiểu** "Dạ em đã đặt lời nhắc" mà tool chưa có success receipt.

Không bắt buộc mỗi câu chat đều gọi tool; hội thoại thường dùng LLM bình thường.

## B6. Clarification thông minh

- Tận dụng context trước khi hỏi lại.
- Chỉ hỏi những thông tin thực sự thiếu/không thể suy ra an toàn.
- Hỏi một câu ngắn, rõ, có thể trả lời tự nhiên.
- Lưu pending clarification; khi user trả lời thì resume đúng task đang đợi.
- Với công việc nhạy cảm luôn kiểm tra permission + approval ở backend; LLM không được tự cấp quyền.

## B7. Tiến độ hữu ích, không spam

Khi user giao tác vụ dài:

1. **ACK sớm**: "Dạ em nhận được rồi ạ, em đang kiểm tra nhé!"
2. **Progress theo mốc thực tế**: "Em đã tải được 3 file, đang tổng hợp dữ liệu..."
3. **Kết quả**: nêu rõ đã xong gì, còn lỗi gì, gửi artifact hoặc link tương ứng.

Quy tắc:

- Thông báo tiến độ chỉ dựa vào **event thật trong backend**, không cho LLM bịa.
- Có thể dùng `sendChatAction` khi phù hợp, nhưng nó **không thay thế** việc thông báo kết quả.
- Không spam nhiều message progress trong một task ngắn; gộp các thay đổi nhỏ.
- Nếu có lỗi/retry cần giải thích đúng trạng thái và cách xử lý.
- Tạo task ID để user kiểm tra với `/status` khi task dài.
- Một reminder đơn giản chỉ cần ACK và một tin nhắn đúng giờ, không bắn hàng loạt tin trung gian.

## B8. Persona tự nhiên, phù hợp ngữ cảnh

- Xưng `em`, dùng "Dạ", "Vâng ạ" tự nhiên, không lặp liên tục ở mọi câu.
- Hóm hỉnh vừa phải, không vô duyên hoặc sai tình huống.
- Khi lỗi hệ thống, Gmail, tiền bạc hoặc bảo mật: ưu tiên rõ ràng, nghiêm túc.
- Chủ động đề xuất bước kế tiếp khi thực sự có ích; không luôn kết thúc bằng một câu hỏi vô nghĩa.
- Tôn trọng sở thích xưng hô người dùng nếu đã lưu hợp lệ.
- Sticker hiện có chỉ dùng theo ngữ cảnh và không để ảnh hưởng luồng tool/reminder.
- Không sửa tính cách bot bằng cách thêm một lượng lớn prompt trùng lặp vào mọi request.

## B9. Scope permissions và bảo mật

- `OWNER_PRIVATE`: full personal tools theo policy, approval cho hành động nhạy cảm.
- `PUBLIC_PRIVATE`: chat/public tools, không truy cập email, secret, owner memory hoặc system settings.
- `GROUP`: chỉ các tool công khai, không rò rỉ nội dung private; group context chỉ lấy dữ liệu bot thực sự được phép nhận.
- Tool registry phải lọc công cụ theo permission trước khi gửi schema cho LLM và kiểm tra lại trong tool executor.
- Coi tin nhắn của người khác, webpage, Gmail, file đính kèm là **untrusted content**. Không cho prompt injection đổi quyền hoặc đọc private data.
- Việc user nói "tôi là chủ" **không** thay thế kiểm tra `senderId` đáng tin cậy từ event Zalo.

## B10. Không phá OpenRouter hiện có

- Giữ nguyên OpenRouter API key/config và hai chế độ `LLM_ROUTING_MODE=single|task` nếu project đã triển khai.
- Không tạo thêm provider mới chỉ để làm reminder.
- Nếu model thiếu tool calling thì không fake lịch; thông báo capability hạn chế và cung cấp command fallback thật hoặc sửa provider config hợp lệ.
- Không thêm loạt biến `.env` về context, memory hoặc reminder không cần thiết.
- Không đổi schema/tool signatures của Gmail/Images/Files nếu không bắt buộc; có migration an toàn nếu cần.

---

# PHẦN C — KIẾN TRÚC TRIỂN KHAI / TEST

## C1. Module/service layout gợi ý

Bám vào cấu trúc thực tế, không nhất thiết tạo đúng tên:

```text
src/modules/reminders/
  reminders.module.ts
  reminders.service.ts
  reminders.repository.ts
  reminders.processor.ts
  reminders.reconciliation.service.ts
  reminders.tools.ts
  reminder-time-parser.ts

src/modules/conversation-intelligence/
  conversation-state.service.ts
  context-resolver.service.ts
  intent-orchestrator.service.ts
  clarification.service.ts
  result-verification.service.ts
```

Dùng Zalo Channel Adapter và Task Queue đã có; không duplicate.

## C2. Persistence & schema migration

Đánh giá schema Prisma hiện tại. Nếu chưa có reminder table phù hợp, tạo migration có index:

- `id` UUID, `ownerUserId`, `channel`, `recipientChatId`, `title`, `note`.
- `dueAt` TIMESTAMPTZ/UTC, `status`, `revision`.
- `createdAt`, `updatedAt`, `queuedAt`, `sentAt`, `cancelledAt`.
- `attemptCount`, `lastError`, `claimedAt`, `claimExpiresAt`.
- `createdFromMessageId` + unique constraint để chống tạo lặp vì Zalo re-delivery.
- `sourceConversationId`/scope để resolve follow-up.
- Notification outbox/delivery attempts nếu cần để phục hồi và audit.

Không xóa dữ liệu hiện tại; migration không destructive. Dùng unique constraint và index cần thiết để tránh xử lý trùng.

## C3. Ví dụ core BullMQ delayed job

Ví dụ sau chỉ để định hướng, cần điều chỉnh với version BullMQ/NestJS hiện tại và persistence strategy:

```ts
const delay = Math.max(0, reminder.dueAt.getTime() - Date.now());

await reminderQueue.add(
  'send-reminder',
  { reminderId: reminder.id, revision: reminder.revision },
  {
    jobId: `reminder-${reminder.id}-${reminder.revision}`,
    delay,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  },
);
```

Worker phải load DB, validate revision, claim job và gọi `zaloAdapter.sendText(recipientChatId, message)`.

**Không xem đoạn code trên là implementation hoàn chỉnh**: phải có worker registration, migrations, outbox/reconciliation, status transitions, retry policy, scopes và test.

## C4. Local run và worker lifecycle

Tạo/hay cập nhật script lệnh dễ hiểu:

```bash
# PostgreSQL, Redis
 docker compose up -d postgres redis

# NestJS nhận Zalo events
 npm run dev

# Worker (nếu repo đang tách process)
 npm run dev:worker
```

Nếu worker chạy trong API process thì README phải ghi rõ; nếu đã tách worker, bắt buộc chạy **cả hai**. Không tạo script giả không tồn tại.

Vì local không có VPS, bot chỉ tự gửi nhắc việc khi máy và worker đang chạy. Khi lên VPS sau này không phải viết lại reminder logic.

Cần lệnh healthcheck hoặc `/health`/`/reminder-health` chỉ Owner để xác minh:

- Redis connected.
- Worker registered/heartbeat còn mới.
- Queue đang hoạt động.
- Số reminder sắp đến hạn.
- Có reminder failed.
- Zalo sending adapter có cấu hình hợp lệ.

**Không trả `healthy` chỉ vì process API còn sống.**

## C5. Automated tests — bắt buộc

Dùng fake timers/clock injection và mocks phù hợp, thêm integration test với Redis thực khi có môi trường test:

1. `10 phút nữa nhắc anh làm việc` → tạo đúng `dueAt` theo thời điểm nhận.
2. ACK chỉ sau khi reminder được persist/enqueue thành công.
3. Reminder được gửi **tự động** khi đến hạn, không có incoming message thứ hai.
4. Không có worker → health báo lỗi; job vẫn ở trạng thái pending/delayed.
5. Worker restart trước deadline → không mất reminder.
6. Redis restart → phục hồi từ DB/reconciliation.
7. Dời thêm 5 phút → job cũ vô hiệu và chỉ gửi ở thời điểm mới.
8. Hủy reminder → không gửi.
9. Duplicate incoming Zalo update → không tạo hai reminders.
10. Retry khi Zalo tạm lỗi → ghi log và không trả success giả.
11. Timeout sau khi Zalo có thể đã nhận → có policy tránh duplicate và trạng thái không chắc chắn.
12. Nhiều reminders cùng thời điểm → không lẫn chat/recipient.
13. Owner trong nhóm yêu cầu đọc Gmail → không tiết lộ dữ liệu.
14. Người khác yêu cầu nhắc Owner → bị từ chối.
15. Câu "lát nữa" → hỏi làm rõ, không chọn thời gian vô căn cứ.
16. "Dời thêm 15 phút" follow-up → gắn đúng reminder.
17. "Cái thứ 2" sau list Gmail → resolve đúng message ID khi được phép.
18. Tin nhắn chứa prompt injection → không nâng quyền.
19. Không có Vision capability → báo rõ thay vì bịa phân tích ảnh.
20. Không có LLM API/Redis config → lỗi được báo đúng; app không giả thành công.
21. Group/private/user context không rò rỉ lẫn nhau.
22. Reconciliation không enqueue trùng khi có nhiều worker/process.

Tạo một **local smoke test** gửi vào Zalo thật với owner token hiện có (chỉ khi user đã cấu hình và chủ động chạy). Test quan trọng nhất:

> Gửi `/reminder-test` và **để yên hoàn toàn**, kiểm chứng sau khoảng 60 giây có tin nhắn bot chủ động gửi về.

Báo rõ kết quả `PASS/FAIL/NOT_RUN`, thời gian thực tế, logs liên quan. Không báo test thành công nếu chỉ test unit mà chưa gửi qua Zalo thật.

## C6. Tài liệu và deliverables

Hãy tạo/cập nhật:

- `README.md`: cách chạy api + worker local, cài Redis/Postgres và test nhắc việc.
- `docs/REMINDER_TROUBLESHOOTING.md`: danh sách nguyên nhân bot im lặng, cách kiểm tra queue/worker/DB/Zalo.
- `docs/CONVERSATION_INTELLIGENCE.md`: context scopes, memory, follow-up, clarification, tool-first, verify.
- `IMPLEMENTATION_STATUS.md`: phần nào DONE, PARTIAL, BLOCKED_BY_CREDENTIALS, NOT_LIVE_TESTED.
- Prisma migration nếu cần.
- Automated tests.

Sau khi code xong, chạy thực tế những lệnh repo đang có như build, lint, typecheck, test; sửa lỗi. Không dừng chỉ vì một module phụ không có credential, nhưng phải ghi rõ thiếu gì.

## C7. Acceptance criteria — điều kiện nghiệm thu

**Reminder:**

- Người dùng nhắn "10 phút nữa nhắc anh làm việc".
- Bot xác nhận thời điểm đúng **chỉ sau khi đã đặt lịch thật**.
- **10 phút sau**, không có incoming message nào khác, worker tự gửi Zalo.
- Worker restart không làm mất reminder đã lưu.
- Cancel/reschedule thực thi thật, không chỉ trả text.
- Owner/private/user scopes bảo mật.
- Nếu không thể gửi, có trạng thái lỗi, logs, retry và thông báo minh bạch khi có kênh gửi được.

**Conversation Intelligence:**

- Hiểu câu tham chiếu như "nó", "cái thứ hai", "dời thêm", "hủy việc vừa rồi" trong scope hợp lệ.
- Có thể nối tiếp workflow nhiều bước bằng Tool Calling.
- Giữ context text + attachment khi đã có tính năng nhận media.
- Biết hỏi ngắn gọn khi thật sự thiếu thông tin.
- Báo tiến độ dựa vào sự kiện thực tế, không spam.
- Kiểm chứng kết quả, không tự tuyên bố thành công khi chưa thực thi.
- Trí nhớ và công cụ cá nhân không lộ cho người lạ hoặc nhóm.

---

# CHỈ DẪN CUỐI CÙNG CHO AI CODING

1. **Đầu tiên hãy sửa lỗi reminder không gửi tin**. Đừng dành toàn bộ thời gian refactor Conversation Intelligence mà chưa có một reminder test chạy được từ đầu đến cuối.
2. Đọc source repo và đánh giá kiến trúc đang có, tận dụng tối đa các module đã viết.
3. Viết code, migration, worker, tests và docs **trực tiếp trong workspace hiện tại**. Không tạo repo mới.
4. Không đòi thêm VPS, không thêm Playwright, không tạo nhiều biến `.env` linh tinh.
5. Không thay đổi Zalo SDK/HTTP architecture đang hoạt động nếu không cần để sửa lỗi.
6. Không sửa OpenRouter routing, Gmail, Sticker, Images, Files ngoài những tích hợp cần thiết.
7. Sau khi reminder hoạt động, tiếp tục triển khai Conversation Intelligence.
8. Nếu không thể test live vì thiếu credential hoặc môi trường, phải nói rõ chính xác trạng thái, không khẳng định đã test thật.
9. Hoàn tất bằng báo cáo file đã sửa, migration, lệnh chạy, kết quả test, những điều còn thiếu và hướng dẫn tự kiểm tra reminder 60 giây.

**Bắt đầu thực hiện ngay, không chỉ trả lời bằng kế hoạch.**

---

## Tài liệu kỹ thuật để đối chiếu

- NestJS Queues: https://docs.nestjs.com/application/queues
- BullMQ delayed jobs: https://docs.bullmq.io/guide/jobs/delayed
- BullMQ Job Schedulers: https://docs.bullmq.io/guide/job-schedulers/
- Zalo Bot Platform: https://docs.zaloplatforms.com/zalo-bot
- `zalo-bot-js`: https://github.com/KaiyoDev/zalo-bot-js

**Lưu ý:** Tài liệu và phiên bản package có thể thay đổi. Kiểm tra `package.json`, API signatures và tài liệu phiên bản thực tế trước khi sửa.
