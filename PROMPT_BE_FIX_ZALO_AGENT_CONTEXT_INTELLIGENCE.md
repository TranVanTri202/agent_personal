# MASTER PROMPT — SỬA TẬN GỐC KHẢ NĂNG HIỂU NGỮ CẢNH & THỰC THI CỦA ZALO AI AGENT

> **Dùng cho AI Coding Agent trong VS Code.** Hãy sửa **trực tiếp backend NestJS hiện có**, không tạo ứng dụng mới. Đọc toàn bộ repository trước khi thay đổi. Mục tiêu: từ một chatbot hay đoán ý thành một **AI Agent hiểu ngữ cảnh, nhận diện nhiều yêu cầu trong một câu, dùng công cụ thật, kiểm chứng kết quả và trò chuyện tự nhiên**.

## 0. Vấn đề cần giải quyết ngay

Hành vi lỗi thực tế:

1. Người dùng gửi một ảnh vào Zalo; bot nói đã nhận/lưu ảnh.
2. Người dùng nhắn: **"Ảnh đó có thông tin gì? Gửi lại coi."**
3. Bot lại mô tả ảnh "mèo chibi trắng đang ngủ" dựa trên suy đoán, **không phân tích được ảnh thực tế và cũng không gửi lại ảnh**.

Đây là **bug chức năng**, không được coi là vấn đề chỉ cần bổ sung vài dòng system prompt.

**Hành vi đúng bắt buộc:**
- Nhận diện đây là **hai yêu cầu**: `analyze_image` và `resend_existing_image`.
- Giải tham chiếu **"ảnh đó"** đến đúng ảnh đã gửi/tạo gần đây nhất **trong đúng ngữ cảnh hội thoại**.
- Nếu ảnh còn tồn tại, đọc nội dung ảnh qua vision model/công cụ đã triển khai, lấy đường dẫn gửi ảnh phù hợp, **gọi sendPhoto thật** và kiểm tra kết quả SDK/API.
- Nếu đã có kết quả vision đáng tin từ ảnh đó, có thể dùng lại nhưng phải lưu được nguồn và phiên bản.
- Nếu model hiện tại **không hỗ trợ vision**, báo rõ không thể phân tích; tuy nhiên **vẫn gửi lại ảnh nếu còn truy xuất được**, không bỏ qua phần còn làm được.
- Nếu media đã bị xóa sau 24 giờ, trả lời rõ ảnh không còn được lưu, không nói đã gửi/đã xem.
- Nếu có nhiều ảnh có thể được nhắc đến, sử dụng quy tắc ưu tiên rõ ràng; chỉ hỏi làm rõ khi thực sự mơ hồ.

## 1. Nguyên tắc bắt buộc

1. **Investigate first, fix root causes.** Không tự suy đoán project đã có/còn thiếu module nào.
2. Giữ nguyên: NestJS, PostgreSQL/Prisma, Redis/BullMQ, `zalo-bot-js` nếu project đang sử dụng, OpenRouter, Gmail, AI Tool Registry, Sticker, Reminder, Supabase Storage tạm thời 24 giờ, hệ thống phân quyền và approval.
3. Không dựng thêm một AI chatbot mới chạy song song. Refactor luồng xử lý hiện có và giữ backward compatibility.
4. **Action first, talk second:** Có yêu cầu hành động thì phải gọi tool thật, không chỉ trả lời kiểu "em đã làm".
5. **No hallucinated actions/content:** Không mô tả ảnh, nội dung email, file, kết quả gửi hoặc thành công của task nếu không có bằng chứng từ tool/model đã nhìn thấy dữ liệu thật.
6. Không chuyển model vô tội vạ. Trước hết sửa pipeline, context, tool loop và tests. Đánh giá model tách riêng bằng benchmark thực tế.
7. Không thêm hàng loạt biến môi trường. Chính sách ngữ cảnh, tool, timeout, follow-up nằm trong config/module, chỉ secret và lựa chọn model cần `.env`.
8. Không truy cập dữ liệu riêng của Owner từ tin nhắn người ngoài hoặc chat nhóm. Quyền phải kiểm tra tại **mỗi tool call**, không chỉ ở prompt.
9. Không tự nhận hoàn thành khi mới code xong mà chưa build/test. Khi thiếu credential, dùng mock và ghi rõ chưa live-test.
10. Không để một câu hỏi đơn giản phải qua planner nặng nếu có đường xử lý rõ ràng; tối ưu latency và chi phí.

## 2. Bước đầu: Audit / Root-cause analysis

Trước khi sửa, rà soát có bằng chứng (file path, class/function, vị trí logic) cho toàn bộ pipeline:

`Zalo incoming update → normalized event → message persistence → media ingestion → conversation retrieval → prompt/context assembly → LLM request → tool call(s) → tool execution → outbound Zalo message → task result`.

Kiểm tra và ghi vào `docs/CONTEXT_INTELLIGENCE_AUDIT.md`:

- Ảnh Zalo nhận vào được lưu như message attachment có `media_id`, `storage_path` không, hay chỉ lưu text "[Ảnh]"?
- Ảnh AI tạo ra có liên kết với conversation và assistant message không?
- Sau 24h, database có phân biệt `EXPIRED/DELETED` và chỉ còn metadata không?
- Lịch sử truyền cho OpenRouter có **attachment/multimodal data** hay chỉ text?
- Khi người dùng gửi liên tiếp ảnh, caption, rồi câu ngắn thì có giữ đúng thứ tự/tương quan không?
- `sendPhoto` có được expose thành tool có thể gọi và có kết quả xác thực không?
- Tool schema, tool call ID, tool result có được chuyển đúng qua OpenRouter không? Tool loop có chạy đến khi hoàn tất không?
- System prompt có đang khiến LLM *tự kể* về ảnh/file thay vì sử dụng tool không?
- Có trường hợp tool fail nhưng LLM vẫn nói "đã hoàn thành" không?
- Context có bị cắt sai, mất assistant/tool history hoặc mất recent media không?
- Incoming group mention/reply có được normalize đúng `senderId`, `chatId`, `replyToMessageId` không?
- Worker có đẩy ACK/progress/result về đúng chat và đúng task không?

**Tạo regression test tái hiện bug "ảnh đó có thông tin gì, gửi lại coi" trước khi fix.**

## 3. Conversation & Media Context Model

Chuẩn hóa **mỗi turn là các content parts**, không chỉ một chuỗi text:

```ts
type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaId: string; source: 'incoming' | 'generated' | 'edited' }
  | { type: 'file'; mediaId: string; mimeType: string }
  | { type: 'audio'; mediaId: string; transcript?: string }
  | { type: 'tool_result_ref'; toolExecutionId: string };

interface ConversationTurn {
  id: string;
  conversationId: string;
  senderId: string;
  role: 'user' | 'assistant' | 'tool';
  chatId: string;
  chatType: 'PRIVATE' | 'GROUP';
  replyToMessageId?: string | null;
  parts: MessagePart[];
  createdAt: Date;
}
```

Điều chỉnh schema theo dự án thật; không phá migration cũ, không nhân đôi bảng nếu đã có dữ liệu tương đương.

**Media metadata** phải có tối thiểu: `mediaId`, `conversationId`, `uploaderId`, `ownerScope`, `source`, `originalMessageId`, `storageProvider`, `storagePath`, `mimeType`, `createdAt`, `expiresAt`, `status` (`AVAILABLE/EXPIRED/DELETED/FAILED`), `derivedFromMediaId?`, `analysisSummary?`, `analysisModel?`, `analysisCreatedAt?`.

- File gốc và ảnh sau chỉnh sửa là **hai phiên bản khác nhau**, liên kết `derivedFromMediaId`.
- Không lưu signed URL vĩnh viễn. Khi cần gửi lại, tạo URL mới còn hiệu lực.
- Sau khi file hết hạn 24h, giữ metadata tối thiểu theo chính sách retention và phân biệt rõ không còn file nhị phân.
- Trong chat nhóm chỉ lưu/đọc đúng các message Zalo Bot API thực sự cung cấp; không giả định có full lịch sử nhóm.

## 4. Context Resolution — Hiểu "cái đó", "ảnh vừa rồi", "file kia"

Xây `ContextResolutionService` (hoặc mở rộng service hiện có) trả về **đối tượng tham chiếu cụ thể** trước khi lập kế hoạch:

```ts
interface ResolvedReference {
  kind: 'image' | 'file' | 'email' | 'task' | 'message' | 'list_item' | 'none';
  entityId?: string;
  sourceMessageId?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string; // ghi log kỹ thuật, không đổ chi tiết nội bộ cho user
}
```

Quy tắc ưu tiên:

1. **Zalo reply_to_message_id** và các tham chiếu rõ ràng (`ảnh thứ 2`, `file báo giá`) trước.
2. Ảnh/file đính kèm **ngay trong tin nhắn hiện tại**.
3. Đối tượng từ **assistant result gần nhất** trong cùng conversation (ví dụ ảnh vừa được bot tạo/gửi).
4. Đối tượng người dùng vừa gửi trong cùng conversation.
5. Follow-up state/task đang mở trong cùng conversation.
6. Chỉ sử dụng semantic context nếu các quy tắc trên chưa đủ.

Với nhóm: không nhầm nhóm A với B, không lấy ảnh của chat riêng, không lấy dữ liệu cá nhân của owner. Trường hợp reply trực tiếp tới tin bot trong nhóm phải tận dụng mapping message gốc. Nếu có nhiều candidate sát nhau, hỏi một câu ngắn: "Dạ anh muốn ảnh thứ nhất hay ảnh vừa tạo ạ?".

Ví dụ regression:
- Gửi ảnh → "nó là gì?" → phân tích ảnh đó.
- Tạo ảnh A → "gửi lại coi" → gửi A, không tạo ảnh mới.
- Gửi ảnh A → tạo ảnh B từ A → "chỉnh cái vừa rồi" → chỉnh B.
- Bot tạo danh sách 5 tên → "cái thứ 3" → lấy đúng mục 3.
- Tạo file Excel → "file đâu" → gửi URL mới của đúng file.
- Owner có email trong private → người trong group nói "email đó" → **không** tham chiếu email private.

## 5. Multi-intent Understanding & Plan Execution

Thêm bước tách **nhiều mục tiêu trong một câu** và phụ thuộc giữa các bước, dùng schema có cấu trúc, ví dụ:

```ts
interface PlannedAction {
  id: string;
  intent: 'analyze_image' | 'resend_media' | 'edit_image' |
          'read_file' | 'create_file' | 'search_email' |
          'send_email' | 'create_reminder' | 'chat' | string;
  resolvedEntityId?: string;
  dependsOn?: string[];
  requiresApproval: boolean;
}
```

**Không cần tạo toàn bộ intent bằng hardcoded keyword.** Dùng LLM để hiểu câu tự nhiên kết hợp resolver/backend validation. Các intent phổ biến, rành mạch như resend media có thể route trực tiếp để giảm latency.

Ví dụ:
- "Ảnh đó có gì, gửi lại coi" → `[analyze_image(imageId), resend_media(imageId)]`; nếu vision lỗi vẫn thực hiện resend.
- "Đọc báo giá và làm Excel so sánh" → đọc file thật → trích xuất → tạo file → gửi link.
- "Gửi lại mail mới nhất và soạn phản hồi" → kiểm tra quyền owner/private → tìm email → soạn **draft** → xin duyệt trước khi gửi.
- "10 phút nữa nhắc tôi" → tạo delayed reminder thật, không chỉ trả lời.
- "Bỏ cái thứ 2 rồi xuất PDF" → lấy danh sách hiện hành → sửa → tạo PDF → gửi link.

Luôn ghi `action plan`, kết quả từng bước, trạng thái `PENDING/RUNNING/WAITING_APPROVAL/COMPLETED/PARTIAL/FAILED` vào task.

**Partial success:** Khi một phần làm được, phải hoàn thành phần đó, báo đúng phần chưa làm được. Không bỏ cả request vì một tool lỗi nếu các bước độc lập.

## 6. Tool Invocation & Action Verification

- LLM chọn tool theo capabilities, backend validate input/schema trước khi gọi.
- Lọc tool trước khi gửi đến model dựa trên `role + chatType + resourceScope`.
- **Kiểm tra lại quyền trong executor** dù đã lọc tool ở bước trên.
- Không tin text do LLM sinh như một bằng chứng tool đã chạy.
- Với Zalo gửi ảnh/tin: lưu `outbound message ID` hoặc response thực từ SDK, phân biệt accepted/delivered nếu API chỉ xác nhận accepted.
- Với file: verify object tồn tại và signed URL còn hiệu lực; với PDF/Excel kiểm tra output có thể đọc và có dữ liệu.
- Với Gmail: chỉ báo "đã gửi" khi provider API xác nhận, chưa duyệt thì chỉ nói "đã tạo bản nháp".
- Thao tác có side effect phải idempotent; không tự gửi lại email/ảnh nhiều lần vì retry job.
- Khi tool fail: lưu lỗi an toàn, retry nếu hợp lý, trả thông báo thật và không bịa.

**Nâng cấp tool** `get_recent_media`, `get_media_metadata`, `analyze_existing_image`, `resend_existing_media`, `get_recent_generated_files` nếu project chưa có. Tool `resend_existing_media` nhận **mediaId** đã resolve, không cho LLM tự truyền URL tùy ý.

## 7. Vision Pipeline — Không bịa mô tả ảnh

Trước khi mô tả ảnh:
1. Xác định media thực tế và quyền truy cập.
2. Kiểm tra file chưa hết hạn (Supabase Temporary Storage TTL 24h).
3. Tạo URL đủ thời gian hoặc data URL/binary theo API model hỗ trợ.
4. Kiểm tra **model đang sử dụng** trên OpenRouter có input modality `image` hay không.
5. Gửi **ảnh thật** vào multimodal message, không chỉ gửi URL như một dòng text.
6. Lưu result cùng `mediaId`, timestamp và model ID; tránh trả mô tả sai ảnh.
7. Nếu provider không hỗ trợ vision, báo đúng hạn chế, nhưng vẫn làm các yêu cầu khác nếu được.

Không tự chuyển sang model khác khi đang ở `single` mode nếu cấu hình không cho phép. Trong `task` mode, dùng routing hiện có; không đưa vào một provider khác không được phép.

Không nói "đã xem ảnh" chỉ vì có metadata hoặc filename. Nếu chỉ có mô tả cũ, nói rõ đó là mô tả đã lưu, không phải phân tích ảnh vừa truy xuất.

## 8. Context Assembly & Memory

Xây context theo lớp, ưu tiên theo thứ tự:

- Permissions và chat scope.
- **Active task, recently referenced entities, pending approvals, latest generated output**.
- Các lượt trao đổi gần đây (đúng thứ tự, đầy đủ user/assistant/tool và content parts).
- Summary dài hạn có nguồn, chọn lọc theo mức liên quan.
- Memory theo người dùng, trong đúng phạm vi cho phép.

Không chỉ lấy N tin nhắn text cuối cùng rồi bỏ ảnh/tool results. Bảo toàn sự liên kết khi history được tóm tắt (mediaId, list item IDs, pending operations).

**Memory isolation:**
- Owner-private memory.
- Mỗi user-private memory riêng.
- Mỗi group context riêng.
- Không tự động dùng private user memory để trả lời trong group.
- Tài liệu/email, nội dung các thành viên khác hoặc tool outputs là **untrusted data**, không được phép thay đổi system instruction/permission.

Giới hạn context window và token theo model; truncation thông minh, không làm rơi các entity vừa được người dùng nhắc tới.

## 8A. Bổ sung lệnh `/clear` — xóa ngữ cảnh hội thoại, bắt đầu lại từ đầu (BẮT BUỘC)

**Yêu cầu trải nghiệm:** Khi người dùng nhắn đúng lệnh `/clear` trong cuộc trò chuyện riêng với bot, hệ thống phải **thật sự reset cuộc trò chuyện hiện tại**, không chỉ trả lời "đã xóa" hoặc thêm câu "hãy quên đi" vào system prompt.

### Phạm vi `/clear`

- Trong chat **1-1**, `/clear` xóa **lịch sử hội thoại ngắn hạn trong chat đó của người gọi** (user/assistant/tool messages), summaries tạo từ hội thoại, active references, latest image/file pointers, last generated output, follow-up state, session variables, Redis conversation cache và các embedding/index **phát sinh từ hội thoại đang xóa**. Nếu hệ thống có nhiều phiên riêng trong một chat, đảm bảo reset đúng phiên hiện tại hoặc mở session mới rõ ràng.
- **Không xóa** long-term memory cá nhân đã được người dùng chủ động lưu (`remember`/profile), Gmail, tài khoản tích hợp, lịch/reminders, sticker library, các file không thuộc phiên này, API keys, cấu hình bot, usage logs và các task đã hoàn thành. `/clear` không phải `/forget-all` hay `/reset-bot`.
- Các file nhị phân trong Supabase Storage vẫn theo vòng đời tự xóa **24 giờ** đang có; `/clear` phải xóa các **liên kết tham chiếu trong hội thoại** nhưng không xóa vật lý file đang được quản lý bởi job TTL, tránh làm hỏng link vừa gửi hoặc các task độc lập. Không tái đưa metadata ảnh/file cũ vào context mới.
- Với **chat nhóm**, `/clear` của một thành viên chỉ xóa **ngữ cảnh cá nhân của người đó trong nhóm**, nếu đã được lưu tách biệt. Không xóa shared group context, tin nhắn hoặc memory của người khác. Nếu backend hiện không hỗ trợ user-scoped group context, trả lời rõ "lệnh này chỉ reset riêng chat cá nhân; ngữ cảnh chung của nhóm chưa bị xóa" và không giả vờ đã reset toàn bộ nhóm. **Chỉ Owner mới được xóa ngữ cảnh chung của nhóm** bằng lệnh quản trị khác (nếu bổ sung thì phải xác nhận), không cho thành viên thường xóa cả group history.
- Quyền dựa trên `senderId`, `chatId`, `chatType` từ **event đã xác thực**, không dựa vào tên hiển thị hay text giả mạo.

### Quy trình xử lý bắt buộc

1. Nhận `/clear` tại **command ingress/dispatcher** trước lúc build prompt hoặc gọi LLM; command phải hoạt động khi OpenRouter lỗi/hết credits.
2. Resolve chính xác `channel + chatId + senderId + conversation/session scope` và kiểm tra quyền. **Không** để `/clear` từ người A xóa memory người B hay owner-private.
3. Dùng DB transaction (hoặc cơ chế nhất quán tương đương) để **đóng session cũ và tạo session mới**, tăng `conversationEpoch`/`generation`, loại bỏ hoặc xóa hẳn các bản ghi context thuộc phạm vi đã chọn. Đồng thời invalidation các Redis keys, vector memories có nguồn từ session cũ và references liên quan. Nếu cần giữ tối thiểu audit cho bảo mật, chỉ giữ metadata không chứa nội dung đã xóa và giải thích rõ phạm vi giữ lại.
4. Với jobs/agent runs/LLM requests đang chạy thuộc **session cũ**: đánh dấu cancel hoặc stale, ngăn kết quả/tool output từ session cũ **ghi trở lại session mới**. Trước mọi ghi/gửi kết quả, so sánh `conversationEpoch`. Các side effect đã thực hiện ngoài hệ thống (email đã gửi, file đã tạo) **không thể hoàn tác**; không âm thầm thực thi lại. Lời nhắc độc lập đã tạo hợp lệ vẫn giữ nguyên và hoạt động đúng lịch.
5. Với approval đang chờ do session cũ khởi tạo, chuyển trạng thái `CANCELLED/EXPIRED` và không nhận `/approve` cũ; không xóa task hoặc hoạt động đã hoàn thành ngoài phạm vi hội thoại.
6. Chỉ sau khi reset thành công mới gửi Zalo: **"Dạ, em đã xóa ngữ cảnh cuộc trò chuyện này rồi ạ. Mình bắt đầu lại từ đầu nhé! ✨"**. Không lưu chính thông điệp lệnh hoặc ACK này vào context mới theo cách tạo lại lịch sử vừa xóa.
7. Nếu DB/Redis có lỗi, bot báo **chưa reset thành công**, không bịa là đã xóa. Dedupe cùng một `messageId` để gọi lại event không tạo hành vi sai.
8. Tin nhắn kế tiếp phải được xử lý như **lượt đầu của một phiên mới**: "ảnh đó", "việc lúc nãy", "cái thứ 2" không được trỏ đến session cũ; bot cần xin người dùng gửi lại dữ liệu nếu cần. Memory dài hạn được lưu có chủ đích vẫn sử dụng theo permission hiện tại.

### Implementation & Testing

- Tận dụng `ConversationService`, `MemoryService`, `ContextResolutionService`, `Redis` và `ZaloChannelAdapter` hiện có; không tạo hệ thống session/command thứ hai nếu project đã có.
- Nếu dùng soft-delete hoặc retention theo schema hiện tại, bảo đảm query/embedding retrieval **không thể lấy lại** nội dung đã clear; nhưng ưu tiên xóa thực sự nội dung history/summary theo đúng yêu cầu. Đồng thời đảm bảo bản sao lưu hệ thống nếu có tuân theo chính sách retention được tài liệu hóa.
- Không thêm biến `.env` cho `/clear`.
- Test tối thiểu: (a) `/clear` sau text; (b) sau ảnh rồi "gửi lại coi"; (c) clear giữa lúc LLM đang chạy; (d) clear khi có tool jobs queued; (e) giữ reminders sau clear; (f) người A không xóa được người B; (g) group user không xóa group-shared context; (h) event trùng; (i) Redis cache bị xóa; (j) không gọi LLM cho `/clear`; (k) long-term memory được giữ; (l) không chấp nhận approval cũ.

**Tiêu chí nghiệm thu:** Nhắn "Chào em, anh tên A" → `/clear` → "Anh tên gì?" phải **không thể suy ra tên A từ lịch sử vừa xóa** (trừ trường hợp A đã được lưu độc lập vào long-term memory có chủ đích; test phải tắt/loại memory này để đánh giá chính xác). Nhắn ảnh → `/clear` → "Gửi lại ảnh đó" phải không tìm được ảnh cũ qua conversation context.

## 9. Conversation Personality & UX

Giữ phong cách bot đã được yêu cầu:
- Tiếng Việt tự nhiên, lịch sự: "Dạ", "Vâng ạ", xưng "em" với owner phù hợp.
- Hóm hỉnh vừa phải trong chat xã hội, không spam emoji, sticker, lời mời tạo thêm sản phẩm.
- Với vấn đề kỹ thuật, lỗi, bảo mật, thanh toán: ngắn gọn, rõ ràng, tập trung giải pháp.
- Không luôn kết câu bằng "Còn gì khác em giúp được không?".
- Có thể nhận ngôn ngữ thân mật, thiếu dấu, câu cụt: "gửi lại coi", "cái trên", "làm luôn", "thôi cái đầu", "đổi màu đi".
- **Không dùng lời nói thay cho tool.**
- Khi task mất thời gian: ACK thật nhanh, sau đó cập nhật ở các mốc thực tế; không tạo progress giả hoặc gửi quá nhiều tin.

Ví dụ câu trả lời đúng:

> "Dạ, em xem lại đúng ảnh vừa gửi và gửi lại cho anh nhé ạ."

Sau đó **thực sự gọi tool**. Chỉ sau khi tool thành công mới nói đã gửi.

Đối với request thông thường không cần tool, trả lời trực tiếp, không bắt buộc mọi câu đều đi qua planner/task queue.

## 10. Group & Public Chat Security

Duy trì 3 context:
- **OWNER_PRIVATE:** full owner tools khi có quyền và approval phù hợp.
- **PUBLIC_PRIVATE:** chat và công cụ public, tài nguyên riêng theo người dùng.
- **GROUP:** chỉ dữ liệu trong nhóm và public tools, không dùng Gmail, memory riêng của owner, tài nguyên của private chat.

- Kiểm tra owner qua **sender ID đã được xác thực**, không qua display name hay câu "tôi là chủ bot".
- Trong nhóm, kể cả owner yêu cầu, dữ liệu Gmail/secret/private file không được xuất vào group. Hướng dẫn chuyển sang private chat.
- Dữ liệu do người A upload không tự cho phép B truy cập ngoài phạm vi phù hợp.
- Public image generation/tool calls cần quota và rate limit an toàn; giữ các chính sách đang có.
- Không giả định Official Bot đọc được tất cả tin nhắn nhóm: chỉ dựa trên events đã nhận và lưu.

## 11. Kiểm tra: lỗi do model hay backend?

Sau khi sửa pipeline, tạo **benchmark cố định** `tests/evals/context-intelligence/` để so sánh model trên cùng dữ liệu đầu vào và cùng tool schemas, không thay đổi nhiều yếu tố cùng lúc.

Nhóm bài test:
1. Resolve ảnh/file/message gần nhất.
2. Multi-intent (phân tích + gửi lại).
3. Follow-up ngắn: "làm luôn", "đổi cái thứ 2".
4. Tool calling đúng schema.
5. Không tự nhận tool thành công khi mock tool fail.
6. Đúng quyền owner/private/public/group.
7. Không bịa mô tả ảnh khi không đưa ảnh vào model.
8. Vision với ảnh thật (chỉ nếu model hỗ trợ).
9. Ambiguous-reference clarification.
10. Tiếng Việt thân mật, viết tắt, không dấu.

Chạy unit/integration deterministic với mock trước. Nếu có API key, làm live smoke test với model đang chọn và tùy chọn một model thứ hai **chỉ khi tôi chủ động cho phép vì có chi phí**.

Báo cáo kết quả theo cột: `test case`, `expected`, `actual`, `model`, `tool selected`, `correctness`, `latency`, `token usage`, `error source`.

**Cách kết luận:**
- Nếu message/media không đến model hoặc tool bị thiếu: lỗi backend/pipeline.
- Nếu context đúng, tool đúng, nhưng model chọn sai intent hoặc argument liên tục: có thể do model; đánh giá model mạnh hơn hoặc cải thiện tool descriptions/system prompt.
- Nếu model ra tool call đúng nhưng backend không thực thi/gửi sai: lỗi agent runtime hoặc Zalo adapter.
- Không thay model để che lỗi pipeline.

## 12. Automated Regression Tests bắt buộc

Viết tests ít nhất cho các trường hợp:

1. Incoming image event → lưu attachment vào conversation.
2. Generated image → lưu asset và link tới assistant turn.
3. Gửi một ảnh A → "gửi lại" → `sendPhoto(A)` thật.
4. Gửi A và B → "gửi ảnh thứ nhất" → A.
5. Bot tạo ảnh B từ A → "chỉnh cái vừa rồi" → edit B.
6. "Ảnh đó có thông tin gì, gửi lại coi" → vision + resend, không chỉ text.
7. Vision không hỗ trợ → resend thành công và báo phần vision không được hỗ trợ.
8. File đã bị xóa sau TTL → không nói đã gửi, không phát URL chết.
9. User gửi Excel → "tổng hợp rồi gửi lại" → đọc file, tạo kết quả và link.
10. Group user không lấy được private image/mail của owner.
11. Người lạ yêu cầu "đổi model" → từ chối ngay trong backend.
12. Context trong nhóm A không rò sang nhóm B.
13. Reply vào một tin cụ thể ưu tiên đúng đối tượng.
14. Multi-intent partial failure không làm mất các bước độc lập.
15. `sendPhoto` fail → không nói gửi thành công.
16. Worker restart giữa task → không gửi trùng output.
17. "nhắc 10 phút nữa" → thật sự tạo BullMQ delayed job, không chỉ trả lời.
18. Nhiều tin nhắn đến nhanh trong cùng một chat → xử lý ngữ cảnh theo thứ tự hợp lý.
19. Input injection trong file/web/group không nâng được quyền.
20. Kiểm thử những câu nói tắt tiếng Việt và giọng điệu tự nhiên.
21. `/clear` trong private tạo session mới và không còn history/summary/references.
22. `/clear` khi job cũ đang chạy không làm output cũ quay lại context mới.
23. `/clear` trong nhóm không xóa dữ liệu người khác hoặc shared group context.
24. `/clear` không xóa reminders/long-term memory độc lập, và không cần gọi LLM.
25. `/clear` hủy pending approvals của session cũ, chống replay.

Có unit tests, integration tests và E2E mocks cho Zalo/OpenRouter/Supabase. Live tests phải ghi rõ đã thực hiện hay chưa.

## 13. Trình tự triển khai

**Phase A — Audit + reproduce:** xác định bug thật và viết failing tests.

**Phase B — Fix data model:** conversation parts, media associations, reference mapping, TTL.

**Phase C — Context resolution:** resolver + active entity + reply-chain support.

**Phase D — Multi-intent/tool executor:** plan → execute → verify → partial success.

**Phase E — Vision + resend:** đưa ảnh thật vào LLM và gửi lại đúng ảnh.

**Phase F — Memory/UX:** follow-up thông minh, ACK/progress, ngôn ngữ tự nhiên, và lệnh `/clear` reset hội thoại thực sự.

**Phase G — Evaluation:** chạy test + model benchmark, sửa lỗi hồi quy.

Không chặn toàn bộ triển khai để hỏi những câu đã có đáp án trong repository. Với vấn đề chưa rõ, ghi giả định hợp lý và tiếp tục những phần có thể làm.

## 14. Deliverables bắt buộc

- Source code đã cập nhật trực tiếp project hiện tại.
- Prisma migrations nếu cần.
- Tests và fixtures.
- `docs/CONTEXT_INTELLIGENCE_AUDIT.md` — nguyên nhân gốc, chứng cứ từ code.
- `docs/CONTEXT_AND_MEDIA_LIFECYCLE.md` — luồng từ sự kiện Zalo đến context/vision/gửi lại media.
- `docs/CONVERSATION_EVAL_RESULTS.md` — kết quả regression/model evaluation.
- `IMPLEMENTATION_STATUS.md` — module thực sự DONE và chưa live test.
- Hướng dẫn test thủ công trên Zalo với chuỗi: **gửi ảnh → "ảnh đó có thông tin gì? gửi lại coi" → kiểm tra ảnh được gửi thật và mô tả đúng**.
- Hướng dẫn kiểm thử `/clear`: reset text/ảnh, giữ reminder, cô lập người dùng và nhóm, xử lý task cũ đang chạy.

Chạy `lint`, `typecheck`, `build`, unit/integration tests. Fix lỗi phát hiện. Không tuyên bố DONE nếu chỉ có code mà thiếu test hoặc các tool đang stub.

## 15. Acceptance Criteria (không thỏa thì chưa hoàn thành)

1. Bot **không còn bịa** nội dung ảnh/file/email khi chưa đọc dữ liệu gốc.
2. Nhận ra và thực hiện **nhiều yêu cầu trong cùng một câu**.
3. "Cái đó", "gửi lại", "cái thứ hai", "chỉnh cái vừa rồi" tìm đúng referent trong đúng phạm vi.
4. Tool phải chạy thật, và bot chỉ báo kết quả đã xác minh.
5. Ảnh/file do bot tạo và ảnh/file người dùng gửi được liên kết với conversation và tồn tại đúng vòng đời 24h.
6. Dù vision thất bại, yêu cầu resend hợp lệ vẫn được thực thi.
7. Không rò rỉ dữ liệu từ Owner-private sang public/group; không chat nào lấy nhầm dữ liệu chat khác.
8. Tác vụ dài có ACK/progress dựa trên sự kiện thật.
9. Đã có regression tests cho tình huống lỗi ban đầu và các ca quan trọng khác.
10. Có báo cáo rõ kết quả đánh giá: lỗi do pipeline, do tool hay do model; **không quy kết do model khi chưa chứng minh**.
11. `/clear` được xử lý trực tiếp ở command layer, xóa đúng ngữ cảnh hội thoại, cô lập group/private, không làm mất reminders hay long-term memory và không cho worker cũ làm bẩn phiên mới.

**BẮT ĐẦU NGAY: đọc source, tái hiện bug bằng test, xác định nguyên nhân, sửa trực tiếp code, chạy test và báo cáo kết quả thật. Không chỉ viết bản thiết kế hoặc đề xuất system prompt mới.**
