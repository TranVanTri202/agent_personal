# PROMPT NÂNG CẤP ZALO PERSONAL AI AGENT
## Sticker thủ công + phản hồi lễ phép, hóm hỉnh + tiến độ xử lý realtime

> **Dành cho:** AI coding agent trong VS Code (Codex, Claude Code, Cursor...).  
> **Phạm vi:** NÂNG CẤP project **Personal AI Agent với Zalo Official Bot API** hiện có, backend **NestJS + TypeScript**, sử dụng Agent Runtime, OpenRouter, PostgreSQL, Redis/BullMQ như dự án đang có.  
> **Không áp dụng:** dự án Zalo cá nhân `zca-js` bán hàng.  
> **Mục tiêu:** code thật, test thật, không chỉ tư vấn hay viết pseudocode.

---

## 1. Yêu cầu tổng quát — đọc trước khi sửa

Hãy khảo sát cấu trúc repo hiện tại và **sửa trực tiếp backend**, giữ nguyên các phần đang chạy:

- Nhận/gửi tin Zalo Official Bot (polling/webhook), kiểm tra owner, group permission.
- OpenRouter (single model/task routing nếu hiện có), Tool Calling, Gmail, Files, Memory, Task Queue, Approval.
- Database và queue hiện tại; **không tạo hệ thống mới**, không đập đi làm lại.
- Không đưa bất kỳ API key/token vào source code, log hoặc câu trả lời.

Triển khai **ba nâng cấp gắn với nhau**:

1. **Sticker thông minh:** Tôi sẽ **tự nhập danh sách sticker ID bằng tay** theo nhóm cảm xúc. AI chọn *có nên gửi* và *cảm xúc nào* theo ngữ cảnh; backend chọn **ngẫu nhiên** một sticker trong nhóm tương ứng rồi gửi bằng API thật.
2. **Phong cách hội thoại:** Bot nói chuyện tiếng Việt **lễ phép, có “dạ”, “vâng” tự nhiên, thân thiện, đôi khi dí dỏm/hóm hỉnh**, nhưng vẫn chính xác, điềm đạm, phù hợp một trợ lý cá nhân có thể làm việc nghiêm túc.
3. **Cập nhật tiến độ:** Nhận yêu cầu xong phải **phản hồi sớm**; với tác vụ kéo dài, thông báo **đang làm bước nào, hoàn tất gì, bị kẹt/lỗi gì, đang chờ duyệt gì**; không để im lặng khiến chủ bot tưởng hỏng.

**Không tạo thêm biến `.env` cho sticker, nhân cách bot, xác suất/cooldown/giới hạn số lượng sticker hoặc thông báo tiến độ.** Các mặc định nằm trong code; sticker ID nằm trong file cấu hình được version control. Tận dụng `.env` sẵn có cho Zalo/OpenRouter/DB/Redis.

**Không áp đặt** xác suất 20%, 3 sticker/ngày, 6 lượt hội thoại, cooldown 10 phút hoặc các hạn mức tuỳ ý. Không gửi sticker bừa bãi, nhưng việc có gửi là quyết định theo ngữ cảnh, không phải random xác suất. Số lượng sticker được người dùng yêu cầu trực tiếp có thể đáp ứng nếu hợp lệ, trong giới hạn thực tế của API.

---

## 2. Tài liệu Zalo Official Bot API — bắt buộc kiểm chứng

Đọc và làm đúng API chính thức, không nhầm với Zalo OA hoặc `zca-js`:

- Sticker: https://docs.zaloplatforms.com/docs/BOT/apis/sendSticker
- Chat action: https://docs.zaloplatforms.com/docs/BOT/apis/sendChatAction
- Text message: https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage
- Nhận sự kiện: https://docs.zaloplatforms.com/docs/BOT/apis/getUpdates

Đã biết từ tài liệu hiện hành:

- `sendSticker`: `POST https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendSticker`, body `{ "chat_id": "...", "sticker": "VALID_STICKER_ID" }`.
- `sendMessage`: gửi văn bản với `chat_id`, `text`; `text` có giới hạn **2000 ký tự**; chia đoạn an toàn khi cần.
- `sendChatAction`: body `{ "chat_id": "...", "action": "typing" }`; đây là trạng thái tạm thời, **không thay thế** thông báo tiến độ bằng text.
- `upload_photo` trong `sendChatAction` có thể chưa khả dụng; **không giả định** hỗ trợ.
- Chưa xác nhận API công khai để thả reaction vào tin nhắn; **không dựng `addReaction`, `reactMessage` hoặc endpoint giả**.
- Chưa có public Bot API tìm sticker theo keyword được xác nhận. **Không tự tìm sticker hoặc sinh ID bằng LLM**.

API adapter phải kiểm tra HTTP status và response thực tế (`ok`/`result` nếu có); handle timeout, retry hợp lý, lỗi invalid sticker. Không log token vì URL có chứa token.

---

## 3. Sticker library: tôi tự nhập ID

Tạo file JSON đơn giản, mặc định tại `config/stickers.json` (hoặc giữ cấu trúc đã có nếu tốt hơn):

```json
{
  "hello": [],
  "happy": [],
  "funny": [],
  "thanks": [],
  "sorry": [],
  "celebrate": [],
  "encourage": [],
  "love": [],
  "surprised": [],
  "thinking": [],
  "goodbye": []
}
```

Các mảng rỗng có chủ ý: **Tôi sẽ điền các ID sticker hợp lệ của mình**. Tuyệt đối không tự chế ra ID cho có dữ liệu mẫu. Có thể đưa ví dụ minh hoạ trong README, nhưng **không để placeholder ID giả trong thư viện runtime**.

Ví dụ sau khi tôi chỉnh:

```json
{
  "hello": ["id_chao_1", "id_chao_2"],
  "happy": ["id_vui_1", "id_vui_2", "id_vui_3"],
  "funny": [],
  "thanks": ["id_cam_on_1"],
  "sorry": ["id_xin_loi_1", "id_xin_loi_2", "id_xin_loi_3"],
  "celebrate": [],
  "encourage": [],
  "love": [],
  "surprised": [],
  "thinking": [],
  "goodbye": []
}
```

**Đây chỉ là ví dụ định dạng — không sử dụng các chuỗi `id_...` này để gửi thật.**

### Yêu cầu kỹ thuật

- Parse JSON có Zod (hoặc thư viện validation đang có), enforce **key là emotion hợp lệ**, mỗi value là `string[]` ID không rỗng, trim và dedupe.
- Startup không bị crash chỉ vì tất cả nhóm chưa có ID. Khi library rỗng: **bot vẫn chat/task bình thường**, chỉ không gửi sticker tự động.
- Nếu JSON lỗi cú pháp hoặc nhóm sai: log rõ vị trí lỗi/validation, sử dụng hành vi an toàn (không gửi sticker) và thông báo kỹ thuật khi dev, không phá luồng chat.
- Tạo `StickerLibraryService` để đọc file. Ưu tiên hot-reload an toàn khi file đổi (hoặc tạo command reload dành cho owner; không cần restart app nếu dễ triển khai).
- Chọn ngẫu nhiên dùng `crypto.randomInt` hoặc random đủ tốt; **không lấy phần tử đầu tiên mãi**.
- Trong cùng một cuộc trò chuyện, nếu nhóm có nhiều ID, ưu tiên tránh ID vừa được gửi bằng danh sách gần đây (có thể dùng Redis/DB đang có). **Đây là giảm lặp, không phải cooldown hay giới hạn gửi**.
- Nếu chỉ có 1 ID thì cứ dùng ID đó, không chặn.
- `sendSticker` trả lỗi: log `taskId/chatId/emotion/stickerId/error` (không log token), không làm hỏng câu trả lời chính; đánh dấu ID lỗi cho việc kiểm tra/không lặp retry mù quáng, nhưng không tự xóa ID do người dùng nhập.
- Không tự gửi sticker trong vòng lặp vô hạn; retry theo mức hợp lý khi lỗi tạm thời. Không gửi lại nếu không xác định được lần gửi trước đã thành công hay chưa.

---

## 4. AI quyết định sticker theo ngữ cảnh, không gửi vô tội vạ

**AI quyết định việc có dùng sticker**, không phải cron, xác suất hay một keyword detector cứng kiểu chứa từ `sorry` là lập tức gửi sticker.

Ví dụ có thể phù hợp:

- Người dùng chào vui vẻ → có thể gửi sticker `hello`.
- Người dùng khen bot hay báo tin vui → có thể chọn `happy`, `celebrate`, `thanks`.
- Bot mắc lỗi nhẹ trong tình huống thân mật → có thể chọn `sorry`.
- Người dùng yêu cầu “gửi 3 sticker vui vui” → gửi 3 sticker phù hợp (nếu thư viện đủ sticker; nếu không có, giải thích ngắn gọn).
- Người dùng đùa vui → có thể chọn `funny`.

Ví dụ **không** phù hợp để trang trí bằng sticker:

- Thông báo lỗi production nghiêm trọng, sự cố mất dữ liệu, downtime.
- Gửi email cho khách hàng, báo cáo tài chính, thông tin nhạy cảm.
- Đang cần xin approval hành động nguy hiểm.
- Đang giải thích kỹ thuật dài, câu trả lời khô/thuần thông tin.
- Đang spam nhiều thông báo tiến độ hoặc chỉ muốn ACK ngắn.

Không cấm sticker vì luật số lượng. Đây là **nguyên tắc phù hợp ngữ cảnh**; nếu người dùng yêu cầu trực tiếp, ưu tiên làm theo nếu có ID hợp lệ và quyền thực thi.

### Thiết kế intent

Tận dụng **chính LLM đang dùng để trả lời** (OpenRouter routing hiện tại), tránh bắt buộc phát sinh một lượt gọi LLM mới chỉ để chọn sticker. Gợi ý output chuẩn hoá khi có thể:

```typescript
interface AssistantPresentationDecision {
  message: string;
  sticker?: {
    send: boolean;
    emotion?: "hello" | "happy" | "funny" | "thanks" | "sorry" |
      "celebrate" | "encourage" | "love" | "surprised" |
      "thinking" | "goodbye";
    reason?: string;
  };
}
```

Đây chỉ là schema định hướng. **Không phá format tool calling** và không đưa presentation metadata lên Zalo như nội dung chat. Nếu runtime có structured output, sử dụng nó hợp lý hoặc phân lớp xử lý sau tool completion. Tool Calling vẫn đúng API/provider.

Quan trọng:

- AI **chỉ chọn emotion**, backend **chọn sticker ID ngẫu nhiên** từ nhóm tương ứng.
- Không cho LLM tự bịa/suy đoán sticker ID, gọi endpoint lạ hoặc chọn path file.
- Chỉ gửi sau khi nội dung text tương ứng đã gửi thành công (trừ trường hợp người dùng yêu cầu sticker-only).
- Không để lỗi sticker khiến task đã hoàn thành bị đánh dấu FAILED.
- Khi nhóm emotion rỗng: bỏ qua sticker, không cần nhắc lỗi cho người dùng trong chat thông thường.
- Nếu người dùng xin sticker cụ thể mà nhóm rỗng: trả lời rằng chưa có ID cho nhóm này và hướng dẫn điền file.

---

## 5. Persona: lễ phép, “dạ vâng”, thân thiện, hóm hỉnh đúng lúc

Tích hợp persona vào **system prompt hiện tại**; không tạo prompt thứ hai đè mất system instruction về tool permissions, privacy, nhiệm vụ hoặc phản hồi trung thực.

### Quy tắc văn phong

- Ngôn ngữ mặc định: tiếng Việt tự nhiên, xưng **“em”**, gọi chủ bot là **“anh/chị”** hoặc theo cách xưng hô đã được người dùng thiết lập trong memory. Nếu không rõ, xưng “em” và dùng “anh/chị”; đừng đoán giới tính.
- Thường mở lời bằng một từ lễ phép khi hợp lý: “Dạ”, “Vâng ạ”, “Dạ vâng”. **Không lặp “dạ” trong từng câu, không câu nào cũng “ạ” một cách máy móc**.
- Thân thiện, nhanh nhẹn, có chút hóm hỉnh trong hội thoại gần gũi. Tếu táo nhẹ nhàng, **không pha trò trong tình huống nghiêm túc**.
- Không thảo mai, nịnh quá đà, dùng câu sáo rỗng hoặc emoji/sticker quá nhiều.
- Khi làm việc chuyên nghiệp (email, báo cáo, code, bảo mật), chính xác và rõ ràng là ưu tiên số một.
- Nói rõ khi chưa biết/chưa làm, không ngụy tạo tiến độ hay thành quả.
- Ưu tiên câu trả lời ngắn cho câu hỏi đơn giản, chi tiết khi cần.
- Nếu lệnh của người dùng không an toàn hoặc vượt quyền, lịch sự giải thích và đề xuất cách an toàn.

### Đoạn persona có thể ghép vào system instruction

> Bạn là trợ lý AI cá nhân có khả năng thực hiện tác vụ thực tế. Bạn nói tiếng Việt, lễ phép, thân thiện; thường xưng “em” và nói “Dạ”, “Vâng ạ” một cách tự nhiên. Bạn có thể dí dỏm nhẹ nhàng, nhưng biết khi nào cần nghiêm túc. Bạn không nịnh nọt, không lặp lại lời lễ phép vô nghĩa, không bịa kết quả. Bạn luôn chủ động xác nhận đã nhận việc và cập nhật tiến độ có căn cứ, nhất là khi tác vụ kéo dài. Bạn chỉ dùng sticker khi cảm xúc và ngữ cảnh thật sự phù hợp, không gửi linh tinh.

### Ví dụ mong muốn

- User: “Hello em” → “Dạ, em có mặt ạ 😄 Hôm nay anh/chị muốn giao em vụ gì nào?” (có thể có sticker hello)
- User: “Kiểm tra 10 mail mới nhất giúp tôi” → “Dạ vâng, em nhận việc rồi ạ. Em đang kết nối Gmail và lấy 10 email gần nhất.”
- Khi đã lấy mail thành công: “Em đã lấy được 10 email. Giờ em đang lọc những thư cần phản hồi ạ.”
- Sau khi xong: “Dạ xong rồi ạ. Có 3 email cần ưu tiên; em tóm tắt ngay bên dưới.”
- User: “Đùa tí đi” → Có thể trả lời dí dỏm vừa đủ, dùng sticker funny nếu thư viện có.
- Lỗi Gmail: “Dạ, em chưa đọc được Gmail vì phiên kết nối đã hết hạn. Em **chưa lấy được email nào**. Anh/chị cần kết nối lại tài khoản giúp em nhé.”
- Tác vụ liên quan bảo mật: dùng giọng điềm đạm, **không sticker, không đùa**.

---

## 6. UX xử lý tác vụ: KHÔNG BẮT NGƯỜI DÙNG CHỜ TRONG IM LẶNG

Đây là yêu cầu rất quan trọng. Người dùng phải biết bot còn sống và đang làm gì.

### 6.1 Phản hồi ngay khi tiếp nhận

Với tin nhắn có công việc cần gọi LLM lâu hoặc tool/job:

1. Nhận event, validate owner, dedupe.
2. Đăng task/job vào queue và lưu DB **nhanh**.
3. Gửi ACK sớm qua `sendMessage`, ví dụ:
   - “Dạ, em nhận việc rồi ạ. Em bắt đầu kiểm tra ngay nhé.”
   - “Vâng ạ, em đang xem nội dung file và chuẩn bị xử lý.”
   - “Dạ, để em lấy dữ liệu Gmail trước rồi tổng hợp cho anh/chị.”
4. Worker tiếp tục làm việc ở background, không block polling/webhook.

Không cần spam ACK cho lời chào và câu hỏi ngắn có thể trả lời gần như ngay lập tức. Có thể áp dụng một ngưỡng ngắn trong code để tránh hiện ACK rồi đáp án gần như cùng lúc; **không phải cấu hình `.env`**.

**Không nói “đang kiểm tra Gmail” nếu job chưa thực sự khởi động thao tác đó**: nếu vừa queue, dùng câu “Em đã nhận yêu cầu, em sẽ bắt đầu kiểm tra Gmail.”

### 6.2 Cập nhật theo trạng thái thật

Chỉ thông báo tiến độ khi có căn cứ từ task lifecycle / tool event, ví dụ:

- `PENDING` → “Đã nhận yêu cầu, đang xếp tác vụ.”
- `RUNNING` → “Em bắt đầu xử lý rồi ạ.”
- `TOOL_STARTED` → “Em đang đọc 10 email mới nhất.”
- `TOOL_COMPLETED` → “Em đã lấy được 10 email, đang phân loại.”
- `GENERATING_FILE` → “Em đang tạo file Excel tổng hợp.”
- `UPLOADING_FILE` → “File đã tạo xong, em đang tải lên để gửi link cho anh/chị.”
- `WAITING_APPROVAL` → “Em đã soạn email; đang chờ anh/chị duyệt trước khi gửi.”
- `COMPLETED` → “Dạ xong rồi ạ…” + kết quả thực tế.
- `FAILED` → “Dạ tác vụ gặp lỗi ở bước …; em đã/chưa làm được …; anh/chị có thể thử lại …”
- `CANCELLED` → “Dạ, em đã dừng tác vụ …” chỉ khi đã xác nhận trạng thái thật.

Không gửi mọi internal micro-step. Gộp các thông báo quá sát nhau, ưu tiên **mốc có ý nghĩa**. Không để luồng chat bị dày đặc bởi các câu “đang làm…”.

### 6.3 Khi tác vụ lâu nhưng không có event mới

Nếu job kéo dài và người dùng chưa thấy diễn biến:

- Có watchdog/timer ở worker hoặc task progress dispatcher kiểm tra job thực sự còn RUNNING và heartbeat còn hợp lệ.
- Gửi một tin nhắn trạng thái định kỳ hợp lý khi đã lâu không có cập nhật, ví dụ: “Dạ em vẫn đang chờ phản hồi từ dịch vụ AI/Gmail, tác vụ chưa bị dừng ạ.”
- Không tự bịa thời gian còn lại, không báo “sắp xong” nếu không biết.
- Nếu phát hiện worker chết, timeout, mất kết nối: chuyển đúng trạng thái `FAILED` hoặc `RETRYING` và báo rõ.
- Dừng mọi heartbeat khi task hoàn thành/thất bại/bị hủy.
- Bảo đảm khi app restart không để interval lạc hoặc duplicate progress messages.

Không cần thêm các env kiểu `PROGRESS_INTERVAL`, `ACK_TIMEOUT`, `STICKER_COOLDOWN`. Chọn các default hợp lý trong code, có test.

### 6.4 `sendChatAction` (typing)

Dùng `sendChatAction({ chat_id, action: "typing" })` khi chuẩn bị trả lời hoặc đang xử lý bước ngắn **nếu phù hợp**. Đây chỉ là hiệu ứng trạng thái tạm thời; **vẫn phải có text ACK/progress cho tác vụ dài**.

- Không giả định Zalo duy trì trạng thái gõ trong suốt job.
- Không gửi typing liên tục nếu không cần.
- Lỗi sendChatAction không làm fail task.

### 6.5 Không nói dối về tiến độ

Tuyệt đối không gửi những câu như:

- “Đã gửi email” khi mới gọi LLM tạo draft.
- “Đang upload file” khi chưa có file.
- “Đã hoàn thành” nếu một trong các bước bắt buộc thất bại.
- “Sẽ xong trong 30 giây” nếu không có ETA thực.

Tách rõ `ACK`, `PROGRESS`, `FINAL`, `ERROR`, `APPROVAL_REQUIRED` ở tầng notification.

---

## 7. Mô hình triển khai NestJS đề xuất

Kiểm tra module hiện tại, tái sử dụng trước khi tạo mới. Chỉ tách những service cần thiết:

```text
src/modules/
  zalo/
    zalo-channel.adapter.ts     # hoặc dùng adapter hiện có
  agent/
    agent.service.ts            # persona + presentation metadata
  stickers/
    sticker-library.service.ts  # đọc/validate config/stickers.json
    sticker-selector.service.ts # random, tránh lặp, validate emotion
    sticker.service.ts          # gửi sendSticker, handle lỗi
  tasks/
    task.service.ts
    task.processor.ts
    task-progress.publisher.ts  # phát sự kiện đúng lifecycle
  notifications/
    progress-notifier.service.ts # ACK / PROGRESS / FINAL / ERROR
    notification-queue.processor.ts
config/
  stickers.json
```

Khuyến nghị dùng `TaskEvent` có cấu trúc:

```typescript
type TaskEventType =
  | 'accepted'
  | 'started'
  | 'tool_started'
  | 'tool_completed'
  | 'waiting_approval'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface TaskProgressEvent {
  taskId: string;
  chatId: string;
  eventType: TaskEventType;
  step?: string;
  toolName?: string;
  description?: string; // thông tin đã xác thực, không dùng model bịa
  occurredAt: string;
}
```

**Quan trọng:** Notification sender phải có queue riêng hoặc outbox/idempotency hợp lý để không gây duplicate khi worker retry. Dedupe theo `taskId + event id` (đối với progress), preserve delivery state. Với final answer, tránh gửi hai lần sau retry khi đã báo thành công. Xử lý message ordering/queued jobs cùng chat khi cần.

### Quy trình hoàn chỉnh

```text
User gửi tin Zalo
      ↓
Zalo Listener (polling/webhook)
      ↓
Check owner + validate + dedupe
      ↓
Classify quick chat vs long task
      ├── Quick → LLM → send text → optional sticker
      └── Long  → create task, enqueue → ACK ngay
                                  ↓
                           Worker xử lý
                                  ↓
                     Publish verified progress
                                  ↓
                 Progress notifier gửi Zalo
                                  ↓
                       Final result qua Zalo
                                  ↓
              AI sticker intent (nếu thích hợp)
                                  ↓
               Random ID → sendSticker (best effort)
```

**Không cần tạo thêm LLM provider** hoặc thay đổi routing hiện tại. Với mỗi yêu cầu, dùng mô hình được OpenRouter config của project chỉ định; thêm persona & sticker intent theo cơ chế phù hợp với existing provider adapter.

---

## 8. Commands phục vụ test (owner-only)

Tạo hoặc mở rộng các lệnh sau, không ảnh hưởng chat thường:

- `/stickers`: liệt kê emotion và **số lượng ID** hiện có, không in hàng trăm ID.
- `/sticker sorry`: chọn random 1 sticker trong nhóm `sorry` và gửi; nếu rỗng báo hướng dẫn điền file.
- `/sticker sorry 3`: gửi 3 sticker được chọn ngẫu nhiên; tránh trùng nếu đủ ID.
- `/sticker-reload`: reload `config/stickers.json` nếu đã implement reload.
- `/status <taskId>`: trạng thái thật (tận dụng command có sẵn).

Các command phục vụ manual sticker **không dùng LLM**, để test chắc chắn. Chỉ owner được gọi; validate input/capability của API. Trước khi gửi số lượng lớn, xử lý rate limit hợp lý.

---

## 9. Test bắt buộc

Viết unit/integration tests bằng Jest hoặc framework repo đang dùng. Mock Zalo API; **không gửi sticker/tin thật khi chạy test mặc định**.

### Sticker

1. JSON có 0 ID → không crash, không gửi.
2. JSON có nhiều ID `sorry` → chọn ngẫu nhiên và chọn từ danh sách hợp lệ.
3. Cùng nhóm nhiều ID → tránh lặp sát nhau trong cùng chat.
4. Chỉ 1 ID → vẫn gửi được nhiều lần theo yêu cầu.
5. JSON lỗi, ID trùng, value sai kiểu → validate/log/fallback đúng.
6. Sticker intent = none → không gọi `sendSticker`.
7. Model định chọn sticker ở ngữ cảnh nghiêm túc → policy ngăn gửi.
8. Nếu không có sticker cho emotion → bỏ qua gracefully.
9. API `sendSticker` lỗi → text response không bị mất; task không bị đánh dấu failed chỉ vì sticker lỗi.
10. Commands `/sticker`, `/stickers`, `/sticker-reload` chỉ owner sử dụng.

### Persona

11. Prompt vẫn giữ permission + tool calling + OpenRouter routing.
12. “Dạ/vâng” tự nhiên, không lặp máy móc.
13. Đùa khi tình huống vui, không đùa khi nội dung nhạy cảm/lỗi nghiêm trọng.
14. Không thông báo đã hoàn thành nếu tool chưa hoàn thành.

### Progress

15. Long task → ACK nhanh sau enqueue, không chờ LLM.
16. Quick chat → không nhất thiết xuất hiện ACK riêng.
17. Progress phản ánh tool start/completed thật.
18. Worker timeout / retry → có thông báo phù hợp, không bịa status.
19. Approval → báo đang chờ duyệt, không tự thực thi.
20. Completed → gửi final một lần, không bị double-send khi retry.
21. App restart → không tạo notification trùng hoặc heartbeat lạc.
22. Mất Zalo API tạm thời → retry hợp lý, không đánh dấu task business thành failed chỉ vì gửi progress thất bại nếu có thể phục hồi.
23. Notification không lộ email nhạy cảm, file secret hoặc prompt nội bộ.

Nếu test live, để riêng lệnh smoke test **yêu cầu owner chạy thủ công** và dùng sticker ID thật.

---

## 10. Documentation & deliverables

Hãy cập nhật:

- `config/stickers.json` (các nhóm rỗng, dễ điền tay).
- `README.md` hoặc `docs/STICKERS.md`: cách lấy sticker ID thủ công theo tài liệu Zalo, điền vào nhóm, reload và test.
- `docs/AGENT_PERSONA_AND_PROGRESS.md`: persona và các trạng thái; flow ACK → progress → final.
- `IMPLEMENTATION_STATUS.md`: đánh dấu DONE/IMPLEMENTED_NOT_LIVE_TESTED/BLOCKED rõ ràng.

Tạo tài liệu hướng dẫn nhanh:

```text
Bước 1: Mở config/stickers.json
Bước 2: Điền ID hợp lệ vào các nhóm cảm xúc
Bước 3: Save file, reload nếu cần
Bước 4: Nhắn /stickers
Bước 5: Nhắn /sticker sorry
Bước 6: Nhắn tác vụ Gmail/file đủ dài để kiểm tra ACK + progress + final
```

**Không cần thêm bất kỳ env nào** cho sticker, persona hoặc progress; thay đổi chỉ ở source/config JSON. Cũng không yêu cầu thêm model AI chỉ để phân loại sticker.

---

## 11. Acceptance Criteria — chỉ kết luận hoàn thành nếu đạt

1. Bot trả lời tiếng Việt tự nhiên, xưng hô lịch sự, biết “dạ/vâng”, có duyên vừa phải.
2. Bot biết khi nào phù hợp để thêm sticker theo ngữ cảnh; **không lạm dụng** và không giới hạn bằng quota/cooldown xác suất cứng.
3. Tôi tự điền nhiều sticker ID dưới mỗi emotion, backend random và giảm lặp.
4. Không có ID → vẫn hoạt động bình thường; sticker lỗi → vẫn gửi được câu trả lời.
5. User ra lệnh tác vụ dài → bot phản hồi **đã nhận** sớm, sau đó cập nhật trạng thái **có căn cứ**, cuối cùng trả kết quả hoặc báo lỗi rõ ràng.
6. Không để người dùng phải chờ trong im lặng dài khi worker còn hoạt động; không spam tiến độ vô nghĩa.
7. Không ảnh hưởng OpenRouter, Tool Calling, Gmail, Files, DB, Queue, owner permissions, polling/webhook hiện tại.
8. Build, lint, typecheck, test phù hợp đều chạy thành công; tình trạng live test được ghi trung thực.
9. Không thêm `.env` mới; không hardcode secrets; không tạo dự án mới.

## 12. Hãy triển khai ngay

1. Đọc và hiểu repo hiện tại.
2. Xác định các module/hook nhận tin, gửi tin, Agent Runtime, Worker, status notification, system prompt.
3. Viết kế hoạch refactor ngắn gọn (5–10 dòng) rồi **code trực tiếp**.
4. Triển khai và nối end-to-end sticker + persona + tiến độ.
5. Chạy các test và sửa lỗi.
6. Báo kết quả, danh sách file đã sửa, các test thực tế, các giới hạn chưa live-tested.

**Không dừng ở đề xuất hay pseudo-code. Nếu thiếu API keys để live-test, hoàn thiện code + mocks và chỉ rõ bước test bằng tài khoản thật.**
