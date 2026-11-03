# PROMPT CHO AI CODING — TÍCH HỢP TẠO / CHỈNH SỬA ẢNH BẰNG OPENROUTER VÀO PERSONAL ZALO AGENT

> **Mục tiêu:** Sửa trực tiếp backend NestJS hiện có, không tạo dự án mới. Xây tính năng **tạo ảnh từ mô tả (text-to-image)** và **chỉnh sửa ảnh có sẵn (image-to-image)** bằng **OpenRouter Image API**; gửi ảnh kết quả về Zalo qua SDK `zalo-bot-js`; lưu ảnh trong Cloudflare R2 / storage adapter đang tồn tại. Đồng thời giữ nguyên tất cả chức năng Agent trước đây.

## 0. Vai trò và cách thực thi

Bạn là Senior NestJS Engineer + AI Agent Engineer. Hãy đọc toàn bộ workspace hiện tại, kiểm tra cấu trúc module, code đang chạy, `.env.example`, các service OpenRouter, `zalo-bot-js`, Tool Registry, BullMQ, PostgreSQL/Prisma, R2, permissions, memory và cách quản lý tiến độ.

- **TRỰC TIẾP CODE, CHẠY TEST, KHÔNG CHỈ ĐỀ XUẤT.** Chỉ viết thêm hoặc refactor vừa đủ; không viết lại backend.
- Không phá hoặc thay đổi ngoài ý muốn những luồng đang dùng: chat, mail, memory, sticker, scheduler, file, approval, task progress, OpenRouter LLM routing.
- Không hỏi tôi chọn lại những công nghệ đã chốt; dùng NestJS + TypeScript + PostgreSQL + Redis/BullMQ + OpenRouter + `zalo-bot-js` + storage adapter hiện có.
- Không tự bịa endpoint, model ID, payload hoặc tính năng. **Đọc tài liệu cập nhật tại thời điểm triển khai** trước khi code.
- Những thứ chưa có secret thì triển khai có mock + test và báo rõ chưa test live.
- Không lộ API key, base64 ảnh, URL chứa token vào log, database audit log hoặc tin nhắn lỗi.
- Khi hoàn thành, liệt kê file thay đổi, test đã chạy và bước tôi cần làm để test trên Zalo.

## 1. Phạm vi / trải nghiệm cần đạt

### 1.1. Tạo ảnh mới

Ví dụ người dùng nhắn:

- `Tạo ảnh con mèo chibi đang code, 1:1`
- `Thiết kế banner quảng cáo phần mềm, tông xanh, 16:9`
- `Vẽ 3 phương án mascot theo phong cách đáng yêu`

Bot phải:

1. **ACK sớm**, ví dụ: `Dạ vâng ạ, em nhận yêu cầu tạo ảnh rồi! Em bắt đầu xử lý nhé 🎨`.
2. Tách yêu cầu tạo ảnh, phong cách, tỷ lệ, số ảnh (nếu nêu rõ), các ràng buộc chữ cần hiển thị.
3. Dùng Agent Runtime hiện tại để lựa chọn tool **`generate_image`**, **không gọi một AI chat khác một cách bắt buộc**.
4. Enqueue job để xử lý ngoài luồng tin nhắn.
5. Gọi **OpenRouter dedicated Image API** bằng chính `OPENROUTER_API_KEY` đang có, dùng image model được cấu hình riêng.
6. Decode ảnh trả về; kiểm tra bytes, định dạng thực, dung lượng; lưu vào R2 hoặc storage adapter hiện có.
7. Gửi **ảnh thật** vào đúng chat Zalo với `sendPhoto` của `zalo-bot-js` (không chỉ gửi link nếu ảnh có thể gửi trực tiếp).
8. Trả trạng thái thành công khi **đã nhận response gửi ảnh thành công**, không phải chỉ khi model tạo xong.
9. Nếu gửi ảnh thất bại nhưng ảnh đã lưu thành công, báo lỗi gửi ảnh và cung cấp **link tải tạm thời được cấp quyền** khi an toàn.

### 1.2. Chỉnh sửa ảnh người dùng gửi

Ví dụ:

- Người dùng gửi ảnh rồi nói `Đổi nền thành màu trắng, giữ nguyên sản phẩm`.
- `Làm bức ảnh này thành phong cách chibi`.
- `Bỏ vật thể bên trái nhưng giữ các chi tiết còn lại`.
- `Lấy ảnh vừa tạo, đổi sang tỷ lệ 9:16`.

Bot phải:

1. Nhận ảnh từ Zalo bằng listener SDK đang có, tải ảnh, validate và lưu riêng **bản gốc**.
2. Ghép đúng yêu cầu với ảnh đính kèm, kể cả trường hợp **gửi ảnh trước rồi nhắn yêu cầu sau**.
3. Khi người dùng nói `ảnh vừa tạo`, `ảnh ở trên`, `chỉnh tiếp`, chọn chính xác ảnh gần nhất **trong cùng phạm vi chat/owner**, không lấy nhầm ảnh từ chat khác.
4. Sử dụng **`edit_image`** và truyền reference image theo định dạng API đang hỗ trợ.
5. Không ghi đè file gốc; lưu phiên bản mới và liên kết lịch sử chỉnh sửa.
6. Gửi ảnh chỉnh sửa thành công về đúng cuộc trò chuyện.
7. Nếu model không hỗ trợ reference image, báo lỗi capability rõ ràng hoặc dùng image edit model được cấu hình. **Không giả vờ đã edit**.

### 1.3. Xem lại ảnh và sửa tiếp

- Người dùng nhắn `Làm tối hơn một chút` sau ảnh kết quả → sử dụng ảnh output cuối cùng làm reference.
- `Gửi lại ảnh gốc` → gửi đúng bản gốc.
- `Cho tôi link tải chất lượng gốc` → tạo signed URL từ R2.
- `Tạo thêm 2 phiên bản` → tạo phiên bản mới, giữ cùng mô tả tham chiếu.
- Không đòi người dùng gửi lại ảnh nếu đã có ảnh hợp lệ trong history cùng chat.
- Khi tham chiếu mơ hồ (có nhiều ảnh khả dĩ), hỏi ngắn gọn ảnh nào thay vì đoán.

## 2. API chính thức phải sử dụng

Tài liệu tham khảo cần đọc:

- https://openrouter.ai/docs/
- https://openrouter.ai/blog/tutorials/image-generation/
- https://openrouter.ai/blog/tutorials/image-generation-models/
- https://openrouter.ai/blog/announcements/image-api/
- https://openrouter.ai/collections/image-models/
- https://github.com/KaiyoDev/zalo-bot-js
- https://kaiyodev.github.io/zalo-bot-js/vi/send-photo

### 2.1. OpenRouter Image Generation

Ưu tiên **dedicated Image API**:

`POST https://openrouter.ai/api/v1/images`

- Auth: `Authorization: Bearer ${OPENROUTER_API_KEY}`.
- Payload tối thiểu `model`, `prompt`.
- Chỉ gửi các optional parameters (`aspect_ratio`, `resolution`, `quality`, `n`, `output_format`...) nếu model endpoint có hỗ trợ.
- **Tuyệt đối không dùng nhầm** `chat/completions` + `image_url` rồi mong tạo ảnh: `image_url` trên chat thường là **đầu vào phân tích ảnh**.
- Response buffered thường có `data[].b64_json`, `data[].media_type`, `usage.cost` (có thể thiếu một số trường). Dùng parser và validation có kiểm soát; xử lý trả nhiều ảnh.
- Không giả định ảnh luôn là PNG; kiểm tra file signature/MIME trước khi lưu và gửi.
- Không đưa base64 output vào context hội thoại LLM và log.
- Kiểm tra HTTP error và response schema; timeout hợp lý, retry chỉ với lỗi tạm thời và tuân theo idempotency/cost policy.

### 2.2. Model capabilities (bắt buộc)

Trước khi bật tạo ảnh/chỉnh sửa ảnh trên một model:

- Dùng `GET /api/v1/images/models` để kiểm tra model **có tồn tại trên Image API** và các `supported_parameters`.
- Nếu cần, kiểm tra `GET /api/v1/images/models/{model-id}/endpoints` (chú ý model-id có dạng `provider/slug`).
- Tạo ảnh: model phải là image generation model tương thích endpoint.
- Chỉnh sửa: cần xác nhận `input_references` được hỗ trợ trên endpoint/model; giới hạn số ảnh tham chiếu.
- Kiểm tra các giá trị `aspect_ratio`, `resolution`, `n`, output format cho model cụ thể; không tự ép tham số mà model không hỗ trợ.
- Nếu model chưa hỗ trợ tham số phụ: bỏ qua tham số tùy chọn khi không làm sai mục tiêu, hoặc trả thông báo rõ nếu không thể đáp ứng yêu cầu (ví dụ bắt buộc 9:16).
- Cache metadata model với TTL phù hợp, có xử lý khi API capability lookup lỗi; không cho chạy với khả năng chưa được xác nhận đối với edit.
- **Không hardcode một model đời cũ là luôn có sẵn.** Người dùng tự điền model ID lấy trên trang OpenRouter.

### 2.3. Editing bằng reference image

Trước khi gọi API:

- Resolve bản gốc từ tin nhắn hoặc file đã lưu; kiểm tra user/chat scope và permission.
- Đọc ảnh vào byte buffer (có size limit), xác định media type, encode data URL nếu cần.
- Truyền `input_references` theo schema đã xác minh, ví dụ dạng sau (xác nhận lại trước khi triển khai):

```json
{
  "model": "<configured-image-model-id>",
  "prompt": "Keep the product unchanged; replace only the background with a soft light gray studio background.",
  "input_references": [
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<base64>"}}
  ]
}
```

- Có thể dùng reference image từ R2 nếu bảo đảm URL truy cập được; ưu tiên xử lý bytes server-side để không gửi URL nhạy cảm lâu dài.
- Không gọi `input_references` nếu model không hỗ trợ.
- Nếu nhiều ảnh reference, chỉ dùng số lượng nằm trong giới hạn được công bố.

### 2.4. Gửi ảnh qua zalo-bot-js

Theo tài liệu SDK:

```ts
await bot.sendPhoto(chatId, caption, photoUrl, {
  reply_to_message_id: originalMessageId,
});
```

**Chú ý signature `sendPhoto(chatId, caption, photo, options?)`**, tránh truyền nhầm thứ tự `caption` và `photo`.

- Dùng Zalo adapter hiện tại, không khởi tạo thêm listener/polling mới.
- Nếu cần truyền URL: tạo signed GET URL ngắn hạn cho object private, phù hợp với yêu cầu Zalo phải tải được ảnh từ URL; kiểm tra thực tế định dạng và hạn sử dụng.
- Nếu SDK/Zalo không lấy được signed URL, xử lý lỗi và fallback link tải. Không công khai bucket chỉ vì tiện gửi ảnh.
- Với nhiều ảnh, gửi lần lượt (`sendPhotos` nếu phiên bản SDK hỗ trợ) và kiểm soát rate limit.
- Trong group, chỉ xử lý các sự kiện mà bot thực sự được Zalo gửi tới; không giả định bot đọc được mọi tin nhắn nhóm.

## 3. Giữ nguyên cấu hình LLM hiện có, chỉ bổ sung tối thiểu

Hệ thống đã có OpenRouter và có thể dùng:

- `LLM_ROUTING_MODE=single` + `LLM_SINGLE_MODEL=...`, hoặc
- `LLM_ROUTING_MODE=task` theo project hiện tại.

**Giữ nguyên cơ chế đó.** LLM hội thoại hiện tại vẫn làm planning, tool calling và quyết định khi nào gọi tạo ảnh.

Image generation là một **media tool** sử dụng image model chuyên dụng (thường khác chat model), nhưng vẫn dùng **cùng `OPENROUTER_API_KEY`**.

Chỉ bổ sung cấu hình tối thiểu khi cần:

```env
# Đã có sẵn từ project
OPENROUTER_API_KEY=

# Model dành cho tạo ảnh, chọn slug hợp lệ tại OpenRouter Image Models
OPENROUTER_IMAGE_MODEL=

# Tùy chọn: nếu để trống, dùng OPENROUTER_IMAGE_MODEL cho edit nếu model hỗ trợ
OPENROUTER_IMAGE_EDIT_MODEL=
```

- Nếu project đã có `IMAGE_GENERATION_MODEL` thì **tái sử dụng tên đó**, không nhân đôi tên biến vô ích.
- Không thêm một loạt env để bật/tắt/cooldown/mỗi tỷ lệ/chất lượng/số ảnh.
- Các policy nội bộ, defaults và public quota (nếu cần) đặt trong code/config/DB đã có, không đẻ nhiều env.
- Nếu không cấu hình image model: chỉ vô hiệu `generate_image/edit_image`, phần còn lại của app vẫn chạy bình thường.
- **Không tự chuyển sang model ảnh khác có phí** nếu chưa được cấu hình.

## 4. Cấu trúc module đề xuất

Điều chỉnh cho phù hợp kiến trúc thực tế, không tạo trùng service có sẵn:

```text
src/modules/image-generation/
  image-generation.module.ts
  image-generation.service.ts
  openrouter-image.client.ts
  image-capability.service.ts
  image-job.processor.ts
  image-context.service.ts
  dto/
  tests/
```

Tool registry:

- `generate_image`
- `edit_image`
- Có thể thêm `get_recent_image` hoặc dùng image context service nội bộ, tránh tool thừa.

Tool inputs phải được validate bằng Zod/class-validator, ví dụ:

```ts
type GenerateImageInput = {
  prompt: string;
  aspectRatio?: string;
  count?: number;
  style?: string;
};

type EditImageInput = {
  prompt: string;
  sourceFileId?: string;
  aspectRatio?: string;
  count?: number;
};
```

Không để client/LLM tự chọn arbitrary external URL/file ID mà không qua ownership check.

Tool outputs nên là structured metadata (`fileId`, `storagePath`, `mimeType`, `width/height` nếu có, `version`, `cost`, `status`) **không phải hàng megabyte base64**.

## 5. Quyền riêng tư và public users — cực kỳ quan trọng

Hệ thống Personal Agent có 2 nhóm người dùng:

1. **OWNER:** chủ bot, chat riêng, dùng các công cụ cá nhân được phép.
2. **PUBLIC / GROUP:** người dùng khác được chat, không được dùng Gmail riêng, memory riêng, tài liệu riêng hoặc cấu hình bot.

Image generation có thể tốn tiền, vì vậy:

- OWNER được phép tạo/chỉnh sửa ảnh trong private chat theo chính sách chung và ngân sách hiện có.
- PUBLIC/GROUP không được tạo ảnh trả phí mặc định nếu chưa được owner cấp quyền rõ ràng. Vẫn chat bình thường.
- Nếu project đã có cơ chế permission/quota theo tool thì tích hợp vào đó; không tạo hệ thống auth thứ hai.
- Có thể cho owner cấp quyền public image tool sau này qua policy lưu DB, có quota theo người và nhóm, kiểm soát chi phí.
- Không chia sẻ ảnh gốc, ảnh kết quả, prompt hoặc file metadata giữa các user/group.
- Chủ bot gửi ảnh riêng không được để người trong nhóm truy vấn bằng câu `lấy ảnh vừa tạo của chủ bot`.
- Ngữ cảnh image chỉ được truy xuất trong đúng user/conversation scope; kiểm tra quyền **trước lúc gọi tool** và **trước khi worker thực thi**.
- Ngăn prompt injection từ hình ảnh, nội dung chat và file ngoài phạm vi quyền.
- Có giới hạn hữu hạn cho `count`, kích thước file, số reference, concurrency; yêu cầu phê duyệt nếu request quá tốn phí. Không cho phép hàng trăm ảnh từ một tin nhắn.

## 6. Tiến độ và phản hồi tự nhiên (không im lặng)

Tính năng này cần tích hợp theo quy ước Personality + Progress hiện tại:

- ACK ngay sau khi nhận yêu cầu hợp lệ.
- Worker gửi cập nhật ở các mốc **thực sự xảy ra**: nhận job → đã bắt đầu gọi model → đã lưu ảnh → đang gửi về Zalo → hoàn thành / lỗi.
- Tránh spam 10 tin nhắn lặp lại; không tự bịa % tiến độ từ API nếu không có thật.
- Có thể dùng `sendChatAction('typing')` khi phù hợp và được SDK hỗ trợ, nhưng **không dùng thay ACK**.
- Giữ văn phong lễ phép, tự nhiên, hơi hóm hỉnh:
  - `Dạ vâng ạ, em bắt đầu vẽ đây! Để xem ý tưởng này lên hình xinh cỡ nào 🎨`
  - `Em đã tạo được ảnh rồi ạ, đang gửi qua Zalo nhé.`
  - `Dạ xong rồi ạ! Anh xem thử bản này có đúng ý chưa nhé 😄`
- Với yêu cầu chỉnh ảnh nhạy cảm, không đùa không đúng lúc.
- Khi lỗi: giải thích chính xác (`model không hỗ trợ edit`, `OpenRouter thiếu credits`, `Zalo không gửi được ảnh`, `timeout`, `file ảnh lỗi`), không báo `xong rồi` nếu thất bại.
- Không cho tính năng smart sticker tự động chiếm chỗ hoặc thay thế ảnh; chỉ gửi sticker nếu context thực sự phù hợp theo logic đang có.

## 7. Lưu trữ, versioning, security

Sử dụng Cloudflare R2 qua storage adapter hiện có. Nếu project còn dùng storage local cho development, vẫn phải chạy được local mà không cần VPS.

- Lưu mỗi output với UUID và đường dẫn duy nhất.
- Phân nhóm theo `ownerId/conversationId/taskId` một cách an toàn, hoặc theo khóa lưu trữ tương đương.
- Bản chỉnh sửa luôn là object mới; giữ liên kết `parentFileId` / `sourceFileId`.
- Metadata: file ID, user ID, conversation ID, task ID, source input, model ID, prompt (đối với public/shared phải tuân thủ quyền truy cập), image generation parameters, file path, MIME, bytes, createdAt, cost và status.
- Chỉ lưu prompt ở nơi được quyền truy cập; mask thông tin nhạy cảm trong logs.
- `usage.cost` có thể thiếu: lưu `null`, không đoán giá.
- Validate chữ ký file, kích thước, số pixel an toàn để chống decompression bomb; chặn SVG/format nguy hiểm nếu pipeline chưa xử lý an toàn.
- Với URL đầu vào: chặn SSRF, private/internal IP, redirect tới mạng nội bộ, oversized files.
- Giới hạn thời gian sống của temp files, xóa ảnh tạm sau khi xử lý; không xóa ảnh gốc.
- Có idempotency cho mỗi job để Zalo message retry không tạo ảnh tính phí trùng không kiểm soát.

## 8. Cơ chế kết hợp hội thoại và ảnh

Những trường hợp cần xử lý:

1. Ảnh kèm caption yêu cầu edit → chạy đúng tool.
2. Ảnh không caption → ACK đã nhận, lưu, hỏi ngắn gọn muốn phân tích hay chỉnh sửa, hoặc giữ ảnh trong context phù hợp.
3. Text ngay sau ảnh: `đổi nền trắng` → lấy ảnh gần nhất đúng chat.
4. Sau khi tạo ảnh: `đổi màu áo thành xanh` → dùng output mới nhất.
5. `giữ nguyên chất lượng gốc` → ưu tiên chính xác tối đa; nếu model image edit không giữ hoàn toàn pixel, nói rõ giới hạn của generative editing. Với yêu cầu chỉ cắt/ghép/resize, ưu tiên xử lý ảnh bằng thư viện deterministic (sharp) thay vì generative AI khi phù hợp.
6. Trong group: không lấy ảnh từ private chat của owner.
7. Model chat single có thể là text-only; **vẫn có thể gọi tool `generate_image`** vì image generation chạy endpoint riêng. Nhưng **phân tích nội dung ảnh** cần vision model hoặc image-captioning pipeline thực sự hỗ trợ; không tự suy diễn ảnh đã được model chat nhìn thấy.

## 9. Kiểm soát chi phí và lỗi

- Trước khi gọi ảnh, xác nhận user được phép và giá/credits/limits khi có thể.
- Một lần tạo ảnh là một khoản phí riêng, không phụ thuộc LLM chat miễn phí.
- Model ID, số ảnh và tham số phải được validate trước khi gửi.
- Không tự retry vô hạn với lỗi 402 / thiếu credits, 401 / invalid key, 400 / invalid request, model unsupported.
- Với timeout, kiểm tra nguy cơ request đã được tính phí trước khi retry; không tự gọi lại nếu không xác minh được trạng thái.
- Lưu thời gian và cost của từng image job.
- Không có model `:free` mặc nhiên cho image generation; kiểm tra catalog thực tế nếu sau này có thay đổi.
- Nếu số dư không đủ, báo cụ thể và gợi ý owner kiểm tra OpenRouter Credits; không gửi API key hoặc thông tin thanh toán.

## 10. Tests bắt buộc

Mock OpenRouter và SDK Zalo trong test mặc định, không tiêu tiền API thật.

Test ít nhất:

1. `generate_image`: từ yêu cầu tiếng Việt đến Tool Registry.
2. `edit_image`: resolve ảnh vừa gửi + prompt edit.
3. Chọn đúng model từ cấu hình.
4. Parser `data[].b64_json`, `media_type`, `usage.cost` optional.
5. `sendPhoto(chatId, caption, url)` **đúng thứ tự tham số**.
6. Đúng owner permission; public/group bị chặn khi chưa cho phép.
7. Không rò image context xuyên conversation/user.
8. Image edit capability reject khi không hỗ trợ `input_references`.
9. `count`, aspect ratio, resolution chỉ dùng khi endpoint cho phép.
10. Duplicate message/job không trigger double billing.
11. Original image được giữ khi edit.
12. Signed URL và fallback khi Zalo gửi ảnh lỗi.
13. Progress: ACK → processing → delivered/error; không báo hoàn thành giả.
14. Thiếu `OPENROUTER_IMAGE_MODEL` chỉ disable feature, không crash toàn bộ NestJS app.
15. Khi provider 402, 429, timeout và invalid image bytes.
16. Existing chat/Gmail/sticker/memory test vẫn pass.

Sau khi test mock thành công, tạo lệnh **manual live smoke test** có cảnh báo sẽ tốn OpenRouter credits và chỉ chạy khi owner chủ động gọi:

- `npm run test:image:live` (nếu convention project phù hợp).
- Test tạo 1 ảnh nhỏ bằng model do user cấu hình, upload storage, gửi thử tới chat owner.
- Test edit 1 ảnh mẫu nếu model hỗ trợ reference.
- Không chạy smoke test trả phí tự động trong CI hoặc setup.

## 11. Tài liệu và bàn giao

Cập nhật:

- `.env.example` (chỉ biến tối thiểu)
- `README.md`
- `docs/IMAGE_GENERATION.md`
- `IMPLEMENTATION_STATUS.md` (nếu đang tồn tại)

README phải có:

- Cách chọn model tạo ảnh trên `https://openrouter.ai/collections/image-models/` hoặc `GET /api/v1/images/models`.
- Cách điền `OPENROUTER_IMAGE_MODEL`.
- Cách kiểm tra khả năng edit và đặt `OPENROUTER_IMAGE_EDIT_MODEL` (nếu cần).
- Ví dụ lệnh Zalo: `Tạo ảnh...`, gửi ảnh → `Đổi nền...`, `Sửa ảnh vừa tạo...`.
- Khác biệt **phân tích ảnh** và **tạo/chỉnh sửa ảnh**.
- Giới hạn gửi ảnh bằng Zalo và cách lỗi được báo.
- Cách cấu hình quyền public trong hệ thống hiện tại; mặc định owner-only cho tool tính phí.
- Danh sách files thay đổi, kết quả build / tests / live test.

## 12. Tiêu chí hoàn thành (acceptance criteria)

Tính năng được coi là DONE khi:

- [ ] Owner nhắn `Tạo cho tôi hình một chú mèo chibi đang code` → bot ACK ngay, job chạy, nhận ảnh thật trên Zalo.
- [ ] Ảnh được lưu storage riêng tư, có record trong database, không mất khi restart.
- [ ] Owner gửi ảnh rồi nhắn `Đổi nền sang màu trắng, giữ nguyên sản phẩm` → dùng input reference và trả ảnh mới; ảnh gốc được giữ lại.
- [ ] Chủ bot chỉnh tiếp ảnh vừa tạo được mà không gửi lại file.
- [ ] Có thể chọn image model qua cấu hình, **không ảnh hưởng LLM chat single/task routing hiện tại**.
- [ ] Không tạo ảnh trả phí cho public/group user trừ khi permission policy cấp quyền.
- [ ] Không thêm nhiều env không cần thiết.
- [ ] Build, typecheck, unit tests và các integration test giả lập thành công.
- [ ] Các thao tác live chỉ được ghi là verified khi đã thử bằng key thật và gửi ảnh thực sự thành công; nếu chưa thì ghi `IMPLEMENTED_NOT_LIVE_TESTED`.

**BẮT ĐẦU NGAY:** Inspect workspace → đối chiếu API tài liệu mới nhất → lập kế hoạch refactor ngắn → code thật → chạy test → ghi báo cáo. Không chỉ viết kiến trúc hoặc pseudo-code.
