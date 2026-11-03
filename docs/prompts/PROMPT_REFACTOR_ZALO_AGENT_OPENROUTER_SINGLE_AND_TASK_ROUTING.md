# MASTER PROMPT — REFACTOR NESTJS ZALO PERSONAL AGENT SANG OPENROUTER + CẤU HÌNH ROUTING THEO TÁC VỤ

> **Dùng nguyên văn tài liệu này với AI Coding Agent trong VS Code (Codex, Claude Code, Cursor...).** Đây là yêu cầu **chỉnh sửa backend hiện có**, **không phải tạo project mới**.
>
> Phiên bản yêu cầu: 1.0 — 28/10/2026. Phạm vi: **Personal AI Agent dùng Zalo Official Bot**, **không phải** bot Zalo cá nhân `zca-js` dành cho bán hàng.

## 0. Vai trò, cách làm việc và phạm vi

Bạn là **Principal NestJS Engineer, AI Agent Architect và Software QA Lead**. Hãy trực tiếp đọc workspace, tìm các service/module đang xử lý LLM và refactor thành một **OpenRouter Gateway** duy nhất, hỗ trợ hai chế độ vận hành cấu hình được:

1. **`single`**: toàn bộ bước suy luận AI đều gọi **một model duy nhất**, được chỉ định bằng `LLM_SINGLE_MODEL`.
2. **`task`**: tùy loại tác vụ mà route đến **model phù hợp nhất theo routing policy được cấu hình**. Có thể gán cứng từng task → model, hoặc (tùy chọn) chọn từ danh sách model cho phép dựa trên năng lực/chi phí/độ trễ/chất lượng đã đánh giá. Không được tự tuyên bố model nào “tốt nhất” nếu không có dữ liệu hoặc tiêu chí đánh giá.

**Cả hai chế độ đều chỉ dùng `OPENROUTER_API_KEY` để gọi LLM qua OpenRouter.** `single` chỉ có một model tại một thời điểm; `task` có thể dùng nhiều model cho các loại công việc khác nhau. Không yêu cầu mua API key riêng OpenAI/Gemini/Claude/DeepSeek để gọi thông qua OpenRouter.

### Quy tắc triển khai

- Kiểm tra cấu trúc dự án, các `.env.example`, LLM adapter cũ, Agent Runtime, tool-call loop, Gmail, Zalo channel, Memory, BullMQ workers, migrations và tests trước khi sửa.
- **Giữ nguyên**: Zalo Bot Official API (polling/webhook), NestJS, PostgreSQL/Prisma, Redis/BullMQ, Gmail, R2/Storage, Task, Approval, Memory và những chức năng đã chạy.
- **Không đưa Playwright trở lại**; không xây dashboard web, không triển khai bot bán hàng `zca-js`.
- Không duplicate Agent Runtime theo từng model. Chỉ có một orchestration layer và một gateway OpenRouter.
- Không hardcode model ID, key, pricing, “model tốt nhất” hoặc token secret trong source.
- Sử dụng các API/documentation OpenRouter **đang có hiệu lực**. Kiểm chứng model ID và capability trước khi dùng; không đoán tên model từ nhãn hiển thị trên UI.
- Mặc định tích hợp OpenRouter bằng **OpenAI-compatible Chat Completions API** hoặc SDK OpenRouter chính thức nếu phù hợp hơn với codebase; đưa ra lý do trong tài liệu. Không mặc định mọi tính năng OpenAI Responses API tương thích 100% khi đi qua gateway.
- Triển khai code, test, migration thực tế; không dừng ở bản thiết kế hoặc pseudo-code.
- Không hỏi lại các câu hỏi mà workspace có sẵn câu trả lời. Khi thiếu credentials, hoàn thành adapter + mock tests và ghi rõ các bước live-test còn thiếu.
- Bảo vệ dữ liệu cá nhân/Gmail: không rò rỉ nội dung, token, secrets trong log hay gửi sang provider khác ngoài danh sách cấu hình.

## 1. Đầu ra bắt buộc

Sau khi hoàn thành, tôi phải có thể:

- Điền một `OPENROUTER_API_KEY` trong `.env`.
- Chọn `LLM_ROUTING_MODE=single` và một model ID để tất cả tác vụ AI đều sử dụng model đó.
- Chọn `LLM_ROUTING_MODE=task` để route khác nhau theo chat, lập kế hoạch, tool calling, email, coding, phân tích ảnh, tài liệu, v.v.
- Điều chỉnh mapping hoặc tiêu chí chọn model **mà không sửa TypeScript business logic**.
- Kiểm tra model nào đã chạy cho từng task, số token và chi phí (nếu API báo được).
- Tiếp tục sử dụng Zalo Bot, các tool và Gmail như trước.
- Khi model không có `tools`, `vision`, context window hoặc khả năng khác cần thiết: có hành vi rõ ràng, an toàn, không giả vờ đã thực hiện.
- Chạy local **không cần VPS** bằng NestJS + PostgreSQL + Redis; backend nhận Zalo qua polling như trước.

## 2. Kiến trúc mong muốn

```text
Zalo Official Bot
       |
       v
NestJS Zalo Channel + Owner Auth
       |
       v
Agent Runtime / Task Engine / Approvals / Memory
       |
       +----> TaskClassifier (metadata + deterministic rules)
       |                |
       |                v
       |          LLMRoutingService
       |          - single mode
       |          - task mode
       |          - policy/rules
       |          - capability filter
       |          - budget/privacy filter
       |                |
       +----------------+
                        v
                 OpenRouterGateway
                 - one API key
                 - normalized messages
                 - tools/function calling
                 - usage/cost
                 - retries/timeouts
                        |
                        v
                 OpenRouter API
                        |
        +---------------+---------------+---------------+
        |               |               |               |
       GPT            Gemini           Claude         DeepSeek / ...
```

**Phân biệt hai khái niệm quan trọng:**

- **Task/model routing trong ứng dụng:** ứng dụng quyết định `model` nào xử lý task nào. Đây là tính năng chính cần xây.
- **Provider endpoint routing của OpenRouter:** sau khi đã chọn một model, OpenRouter có thể chọn endpoint/provider phục vụ model đó theo policy. Hai cơ chế không thay thế cho nhau.

## 3. Cấu hình `.env` — dễ dùng nhất có thể

Tạo và validate cấu hình dưới đây. Cấu hình **đơn giản nhất phải chỉ cần key + mode + model**.

```dotenv
# ================= OPENROUTER =================
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_NAME=My Zalo Personal Agent
OPENROUTER_APP_URL=

# ================= CHOOSE MODE =================
# single | task
LLM_ROUTING_MODE=single

# Khi single: tất cả bước dùng model này
# Dùng model ID chính xác lấy từ https://openrouter.ai/models
LLM_SINGLE_MODEL=

# Khi task: model mặc định nếu category không có rule
LLM_DEFAULT_MODEL=

# ================= TASK ROUTING =================
# rules | adaptive (adaptive là tùy chọn, mặc định rules)
LLM_TASK_ROUTING_STRATEGY=rules
LLM_TASK_ROUTING_CONFIG=./config/llm-routing.json

# ================= EXECUTION =================
LLM_REQUEST_TIMEOUT_MS=60000
LLM_MAX_RETRIES=2
LLM_MAX_OUTPUT_TOKENS=4096
LLM_MAX_STEPS=15
LLM_MAX_TOOL_CALLS=30
LLM_MAX_CONCURRENT_REQUESTS=3

# ================= COST & PRIVACY =================
LLM_MAX_USD_PER_REQUEST=0.10
LLM_DAILY_BUDGET_USD=1.00
LLM_MONTHLY_BUDGET_USD=20.00
OPENROUTER_REQUIRE_ZDR=false
OPENROUTER_DENY_DATA_COLLECTION=true
OPENROUTER_ALLOW_PROVIDER_FALLBACKS=true
# Fallback sang MODEL KHÁC là tắt theo mặc định (độc lập provider failover)
LLM_CROSS_MODEL_FALLBACK_ENABLED=false

# ================= MODEL CATALOG =================
LLM_MODEL_CATALOG_CACHE_TTL_MINUTES=360
LLM_VALIDATE_MODEL_ON_STARTUP=true

# ================= AUDIT =================
LLM_LOG_PROMPT_CONTENT=false
LLM_LOG_TOOL_PAYLOAD=false
LLM_TRACK_USAGE=true
```

**Quy tắc precedence:** `env` global controls → cấu hình route file → task-context overrides được hệ thống cho phép. Không cho nội dung text do người dùng hay email/webpage gửi đến tự override provider/model, privacy policy hoặc budget.

Nếu `LLM_ROUTING_MODE=single` thì **không** chạy bộ phân loại dùng thêm một LLM để quyết định model; luôn gọi `LLM_SINGLE_MODEL`. Cấu hình task mapping bị bỏ qua một cách rõ ràng.

Khi `LLM_ROUTING_MODE=task`, nếu category thiếu mapping thì sử dụng `LLM_DEFAULT_MODEL`, sau khi đã xác minh model có capability cần thiết; nếu thiếu thì trả capability error (không giả vờ xử lý).

Không yêu cầu điền API key của các nhà cung cấp khác. Các env cũ `OPENAI_API_KEY`, `GEMINI_API_KEY`, v.v. có thể được giữ để tương thích codebase nhưng không dùng khi `LLM_PROVIDER=openrouter`; không xóa cấu hình unrelated nếu đang có tính năng khác phụ thuộc.

### Ví dụ A — 1 model cho mọi tác vụ

```dotenv
LLM_PROVIDER=openrouter
LLM_ROUTING_MODE=single
LLM_SINGLE_MODEL=provider/exact-model-slug
OPENROUTER_API_KEY=your-openrouter-api-key
```

### Ví dụ B — route theo tác vụ

```dotenv
LLM_PROVIDER=openrouter
LLM_ROUTING_MODE=task
LLM_TASK_ROUTING_STRATEGY=rules
LLM_DEFAULT_MODEL=provider/default-model-slug
LLM_TASK_ROUTING_CONFIG=./config/llm-routing.json
OPENROUTER_API_KEY=your-openrouter-api-key
```

> Các chuỗi `provider/exact-model-slug` chỉ là **placeholder**, không phải model ID thật; luôn lấy ID từ OpenRouter Model Catalog. Không mặc định bản free luôn có tool calling, vision hay đủ quota.

## 4. File cấu hình routing theo tác vụ

Tạo `config/llm-routing.json` (có JSON schema + Zod validation) với ví dụ **để placeholder model**:

```json
{
  "version": 1,
  "strategy": "rules",
  "defaultModel": "provider/default-model-slug",
  "taskModels": {
    "chat": "provider/fast-chat-model-slug",
    "intent_classification": "provider/fast-chat-model-slug",
    "planning": "provider/reasoning-model-slug",
    "tool_calling": "provider/tool-capable-model-slug",
    "gmail_read": "provider/long-context-model-slug",
    "gmail_summary": "provider/long-context-model-slug",
    "gmail_draft": "provider/strong-writing-model-slug",
    "document_summary": "provider/long-context-model-slug",
    "document_extraction": "provider/structured-output-model-slug",
    "coding": "provider/coding-model-slug",
    "image_understanding": "provider/vision-model-slug",
    "translation": "provider/fast-chat-model-slug",
    "general_reasoning": "provider/reasoning-model-slug"
  },
  "requirements": {
    "tool_calling": ["tools"],
    "image_understanding": ["image_input"],
    "document_extraction": ["structured_output"]
  },
  "modelAllowlist": [],
  "modelDenylist": [],
  "adaptive": {
    "enabled": false,
    "profile": "balanced",
    "candidateModelsByTask": {},
    "qualityScoresSource": "./config/model-evaluations.json"
  }
}
```

Đây là **mẫu cấu trúc**, không phải file production chạy ngay với placeholder. Hãy tạo thêm:

- `config/llm-routing.example.json` chứa ví dụ như trên.
- `config/llm-routing.json` thực tế chỉ dùng model ID hợp lệ sau khi người triển khai chọn/kiểm chứng (hoặc tạo seed từ env).
- `config/llm-routing.schema.json` hoặc validator tương đương.
- `npm run llm:validate-routing` để kiểm tra model IDs, capabilities, missing mappings, giá và các lỗi cấu hình.

Nếu muốn tất cả cấu hình trực tiếp qua `.env`, có thể hỗ trợ **optional overrides** như `LLM_TASK_MODEL_CHAT`, `LLM_TASK_MODEL_PLANNING`, `LLM_TASK_MODEL_TOOL_CALLING`, `LLM_TASK_MODEL_GMAIL_SUMMARY`, `LLM_TASK_MODEL_VISION`... với ưu tiên cao hơn file mapping; **không bắt buộc** phải có hết.

## 5. Phân loại tác vụ đúng cách

Tạo `TaskCategory` (enum/union) thống nhất và `TaskClassifierService`:

- `chat` — hội thoại thuần túy.
- `intent_classification` — phân loại yêu cầu nếu thực sự cần.
- `planning` — phân rã mục tiêu, lập kế hoạch.
- `tool_calling` — chọn tool, tạo function arguments, phản hồi sau tool result.
- `general_reasoning` — bài toán phân tích sâu.
- `gmail_read` — đọc/nghiên cứu nội dung email.
- `gmail_summary` — tổng hợp thread, daily digest.
- `gmail_draft` — soạn nháp/trả lời email.
- `document_summary` — đọc/tóm tắt văn bản.
- `document_extraction` — trích xuất dữ liệu có cấu trúc.
- `coding` — đọc và phân tích code, issue, debug.
- `image_understanding` — hiểu, OCR bằng vision model nếu có.
- `translation` — dịch thuật.

Phải cho phép mở rộng categories mà không sửa gateway.

### Quy tắc phân loại

1. Ưu tiên metadata từ chính **task/tool hiện có**. Ví dụ tool `gmail_summarize_thread` → `gmail_summary`, nhánh `generate_email_draft` → `gmail_draft`.
2. Ưu tiên workflow stage; ví dụ bước gọi tool → `tool_calling` dù toàn task là Gmail.
3. Có rule-based classifier cho yêu cầu text rõ ràng, đơn giản.
4. Nếu không chắc chắn → `chat` hoặc `general_reasoning` tùy loại workflow, không tự đẻ một API call tốn phí chỉ để hỏi dùng model nào.
5. Không tin nhãn task do **email, webpage, tài liệu hoặc người không phải owner** cố tình chèn vào nội dung.
6. Lưu `taskCategory`, `routingReason` và `selectedModel` trong trace/task metadata.

### Vấn đề multi-step

Một nhiệm vụ có thể có **nhiều bước và nhiều category**. Ví dụ:

```text
"Đọc Gmail, tổng hợp các email quan trọng rồi soạn bản trả lời"
  1. planning          → model reasoning (nếu task mode)
  2. tool_calling      → model hỗ trợ tool
  3. gmail_summary     → model tóm tắt
  4. gmail_draft       → model viết email
  5. approval          → do backend/owner xử lý, KHÔNG phải LLM tự duyệt
```

**Quan trọng:** Không đổi model ở giữa một tool-call/tool-result turn còn dang dở. Chỉ đổi khi đã hoàn tất một logical phase có thể tái tạo context chuẩn hóa. Persist agent/tool states để retry/restart không làm hỏng lịch sử.

## 6. Adaptive task routing (tùy chọn trong task mode)

Cần hỗ trợ cấu hình `LLM_TASK_ROUTING_STRATEGY=rules|adaptive`.

- `rules` (**MVP mặc định**): mapping cố định theo category, predictable, dễ debug, không phát sinh router LLM call.
- `adaptive` (**nâng cao, chỉ bật khi đủ dữ liệu**): chọn **trong một allowlist** cho mỗi category dựa vào các tiêu chí đã cấu hình, không tự khám phá và chọn model ngoài allowlist.

### Chính sách tối ưu

Cho phép profile:

- `economy`: ưu tiên chi phí thấp nhưng phải đáp ứng capability + ngưỡng chất lượng tối thiểu.
- `balanced`: cân bằng chất lượng, giá và độ trễ.
- `quality`: ưu tiên chất lượng/task success đã đo được.
- `latency`: ưu tiên tốc độ.

Mỗi model candidate cần metadata:

- Exact OpenRouter model ID.
- `supportsTools`, `supportsVision`, `supportsStructuredOutput`, `supportsAudioInput`... (chỉ những capability xác thực được).
- Context window và max output tokens, nếu API metadata có.
- Input/output pricing (cập nhật từ catalog khi có).
- Latency/throughput đo từ runtime hoặc nguồn tin cậy.
- Task-specific quality score thu từ **bộ evaluation của chính dự án**, không được tự chế điểm.
- Privacy eligibility và owner allowlist.

Scoring phải deterministic, configurable, có trace lý do chọn. Không đặt điểm chất lượng ảo để khẳng định “tối ưu”. Nếu chưa đủ quality metrics, `adaptive` nên từ chối kích hoạt hoặc dùng `rules` và ghi rõ lý do.

Không thực hiện live pricing/quality lookups cho từng request; dùng cached metadata với TTL và refresh nền/công cụ riêng.

Có thể nghiên cứu `openrouter/auto` như một lựa chọn thử nghiệm **chỉ khi owner bật riêng**; **không** xem đó là tương đương routing cố định hay mặc định bật (vì nó tự quyết định model/giá và có semantics riêng).

## 7. Model Catalog & Capability Validation

Tạo `OpenRouterModelCatalogService` sử dụng API model list chính thức để:

- Lấy model IDs, `supported_parameters`, input/output modalities, context info, price metadata nếu được trả về.
- Cache trong memory/Redis, TTL cấu hình, tránh gọi catalog mỗi tin nhắn.
- Refresh manual và định kỳ.
- Cho phép `npm run llm:list-models` (optional filter tools/vision/cost).
- `npm run llm:validate-routing` xác minh tất cả model trong mode hiện hành tồn tại và tương thích (nếu có API key/network), có warnings rõ ràng nếu offline.

Khả năng kỹ thuật phải được kiểm tra theo **model/endpoint**, không suy từ provider brand. Không phải mọi model hỗ trợ Tools, Vision, JSON mode, Audio, temperature hoặc reasoning params.

### Bắt buộc hỗ trợ capability-aware execution

- `tool_calling`: phải có `tools` capability.
- `image_understanding`: phải hỗ trợ image input. Nếu không hỗ trợ: dùng model mapping đã được chủ sở hữu cấu hình trong `task` mode, hoặc báo lỗi khả năng trong `single` mode. **Không tự bí mật gọi một model khác khi `single`.**
- File Excel/Word/PDF: parsing/generation là deterministic tool của backend; LLM chỉ phân tích/tạo nội dung. Đừng nhầm tool tạo file với model hỗ trợ file modality.
- Voice: STT/TTS là các service chuyên biệt, **không mặc nhiên được cover bởi một chat model**. Nếu yêu cầu strict one-model-for-all, khi model không hỗ trợ audio thì thông báo hoặc dùng adapter STT/TTS đã được user bật rõ; không âm thầm gọi model thứ hai.
- Model không hỗ trợ context length cần xử lý chia đoạn/tóm tắt hoặc báo thiếu khả năng, không cắt context silently.
- Các model có restrictions về `temperature`, structured output, reasoning settings: chỉ gửi params khi tương thích.

## 8. OpenRouter Gateway implementation

Tạo module dịch vụ (điều chỉnh path theo project thực tế):

```text
src/modules/llm/
├── llm.module.ts
├── llm.service.ts
├── llm.types.ts
├── openrouter/
│   ├── openrouter.client.ts
│   ├── openrouter.gateway.ts
│   ├── openrouter.catalog.ts
│   ├── openrouter.error-mapper.ts
│   └── openrouter.usage.ts
├── routing/
│   ├── task-category.ts
│   ├── task-classifier.service.ts
│   ├── llm-routing.service.ts
│   ├── routing-config.schema.ts
│   └── adaptive-selector.service.ts
└── __tests__/
```

### Public interfaces (có thể điều chỉnh)

```ts
export type LLMRoutingMode = 'single' | 'task';

export type LLMTaskCategory =
  | 'chat' | 'intent_classification' | 'planning' | 'tool_calling'
  | 'general_reasoning' | 'gmail_read' | 'gmail_summary'
  | 'gmail_draft' | 'document_summary' | 'document_extraction'
  | 'coding' | 'image_understanding' | 'translation';

export interface LLMExecutionContext {
  taskId?: string;
  conversationId?: string;
  category: LLMTaskCategory;
  requiresTools?: boolean;
  requiresVision?: boolean;
  requiresStructuredOutput?: boolean;
  sensitivity?: 'normal' | 'sensitive';
  estimatedInputTokens?: number;
}

export interface ResolvedModel {
  modelId: string;
  mode: LLMRoutingMode;
  category: LLMTaskCategory;
  reason: string;
  capabilityVerified: boolean;
}

export interface UnifiedLLMResponse {
  requestedModel: string;
  actualModel?: string;
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    argumentsJson: string;
  }>;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
}
```

**Yêu cầu bổ sung:**

- `OpenRouterGateway` nhận normalized messages, tool definitions, params và `ResolvedModel` rồi gọi API.
- Đọc `response.model` thực tế và lưu requested/actual model để phát hiện nếu gateway dùng model khác do router/fallback đã bật.
- Dùng `AbortSignal`/timeout và bounded retry.
- Parse `tool_calls` (có thể nhiều calls). Kết nối `tool_call_id` với tool result đúng giao thức.
- Không đánh mất thông tin reasoning/continuation mà model yêu cầu; nếu provider/model có cấu trúc metadata riêng, hãy xác minh tài liệu và đưa vào normalized conversation state thay vì loại bỏ tùy tiện.
- Không ghép tool output bị lỗi như thể là thành công.
- Structured outputs cần validate bằng Zod, retry có giới hạn với repair rõ ràng khi cần.
- Tách request/response mapping, không đặt logic gọi Gmail/Tools trong gateway.

### Code kết nối tham khảo (không phải toàn bộ implementation)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  timeout: 60_000,
});

const completion = await client.chat.completions.create({
  model: resolvedModelId,
  messages: normalizedMessages,
  tools: normalizedTools,
});
```

- Tùy chọn headers app attribution theo hướng dẫn OpenRouter đang có hiệu lực.
- Không gửi `tools: []`/tham số không hỗ trợ một cách mù quáng.
- Nếu chọn official `@openrouter/sdk`, giữ nguyên abstraction và test parity.

## 9. Tools, approvals và workflow không được bị hỏng

**Bất biến bắt buộc:** đổi model không được thay đổi quyền hạn của agent.

- Tool Registry vẫn quyết định tool nào được phép gọi.
- Tool schema phải được gửi đúng format OpenRouter/OpenAI-compatible.
- Validate `function.arguments` theo Zod/schema.
- Không thực thi tool do model tự bịa tên.
- Tool call với side-effect phải kiểm tra `OwnerGuard`, permission và `ApprovalGuard` **ngay trước execution**.
- Đặc biệt `gmail_send`, `gmail_move_to_trash`, `write_file`, tác vụ thay đổi code... không được tự chạy thiếu approval.
- Khi LLM timeout/retry hoặc route sang model khác, **không chạy lại side-effect đã thành công**. Dùng idempotency keys và tool execution persistence.
- Lock tool-call cycle, không đổi model giữa lời gọi tool và tool result nếu có nguy cơ mất tương thích state.
- Chặn prompt injection từ email/tài liệu/web/nhóm Zalo.
- Đảm bảo task qua BullMQ có thể resume sau restart, cancel, audit.
- Kênh Zalo Official Bot vẫn nhận tin qua polling local, webhook production; không đổi API/event adapter nếu không cần.

## 10. Fallback, lỗi và chi phí

### Phân biệt fallback

1. **Provider endpoint failover**: OpenRouter có thể chuyển endpoint phục vụ **cùng model**; cho phép kiểm soát bằng `OPENROUTER_ALLOW_PROVIDER_FALLBACKS` và privacy policy.
2. **Cross-model fallback**: dùng **model khác** khi model đang chọn lỗi; mặc định `LLM_CROSS_MODEL_FALLBACK_ENABLED=false`. Nếu bật, phải có danh sách model riêng theo category, từng candidate phải đạt capability/privacy/budget. **Không dùng fallback làm thay đổi ý nghĩa `single` mode**: trong `single`, nếu có cross-model fallback thì phải tắt hoặc yêu cầu thiết kế explicit opt-in khác được owner duyệt.

Phân loại lỗi 401/403, 402 thiếu credits, 404 model/capability, 429 rate limit, 5xx, timeout, invalid JSON/tool args. Retry chỉ với lỗi phù hợp và có backoff, không loop vô hạn.

### Budget & cost

- Lưu requested/actual model, number of requests, latency, input/output tokens, tool calls và chi phí khi có dữ liệu đáng tin cậy.
- Nếu OpenRouter trả về token usage/cost hợp lệ thì dùng dữ liệu thực, không tự bịa giá.
- Nếu phải ước tính trước request, dùng model pricing metadata + token estimation với nhãn **estimated**, không trộn với actual.
- Có `LLM_MAX_USD_PER_REQUEST`, daily/monthly budget soft guard; từ chối các tác vụ dự kiến vượt budget khi cần. Đừng tự động tin con số ước tính là bảo đảm chính xác.
- Ghi DB theo chuẩn dự án đang có, tránh migration phá dữ liệu cũ.
- Có `npm run llm:smoke` gọi provider thật chỉ khi chủ động bật flag và có API key; tránh chạy smoke tiêu tốn tiền trong CI mặc định.

## 11. Riêng tư và bảo mật qua OpenRouter

Email và file cá nhân có thể chứa dữ liệu nhạy cảm. Mặc định:

- `OPENROUTER_DENY_DATA_COLLECTION=true`: áp dụng provider policy tương thích theo API nếu được hỗ trợ/được xác minh. Nếu không có provider hợp lệ, fail closed hoặc báo lỗi rõ — không âm thầm bỏ policy.
- `OPENROUTER_REQUIRE_ZDR=false` mặc định vì việc bắt buộc ZDR có thể làm mất endpoint free; nhưng cho phép owner bật `true` để chỉ dùng endpoints Zero Data Retention. Giải thích rõ đánh đổi.
- Bất kỳ lựa chọn model/provider nào đều phải tuân thủ chính sách privacy, allowlist và budget.
- Không tự route dữ liệu Gmail/document riêng tư tới model khác ngoài mapping đã cho phép.
- Không log raw email, request headers, API key, refresh token, prompt nhạy cảm hoặc signed download URLs.
- Chỉ owner Zalo được gọi `/model`, `/routing`, `/usage`; người lạ/nhóm không được đọc cấu hình riêng.
- `OPENROUTER_API_KEY` chỉ có ở backend, không hiển thị trong logs, Telegram/Zalo hay phản hồi AI.
- Dữ liệu gửi qua OpenRouter đi qua một nền tảng trung gian rồi đến inference provider; cập nhật tài liệu riêng tư cho chủ sở hữu.

## 12. Lệnh quản trị qua Zalo (read-only mặc định)

Giữ các lệnh hiện có và thêm:

- `/model` — hiển thị mode, model mặc định, model gần nhất thực sự xử lý tác vụ; không lộ key.
- `/routing` — hiển thị `single` hay `task` và mapping đang áp dụng (chỉ owner).
- `/models` — liệt kê các model đang được cấu hình, khả năng và validation status; không liệt kê cả catalog dài.
- `/ai-usage` — thống kê usage theo ngày/model.
- `/ai-health` — kiểm tra OpenRouter connectivity/config khi đủ quyền, không lộ secret.

Không yêu cầu thay đổi model/routing qua Zalo trong MVP; thay `.env` và config file rồi restart là đủ. Có thể hot reload qua admin command trong tương lai, nhưng **không bật remote write config mặc định**.

## 13. Automated tests & acceptance criteria

Tạo unit tests/integration tests sử dụng mock responses, ít nhất cho:

1. `single`: 100% LLM calls chọn đúng `LLM_SINGLE_MODEL` dù task category khác nhau.
2. `single`: mapping task bị bỏ qua.
3. `task/rules`: chat, planning, tools, Gmail, code, vision chọn đúng model theo file config.
4. Category chưa mapping → default model; nếu default thiếu capability → lỗi rõ.
5. `task/adaptive`: chỉ model trong allowlist, có đầy đủ capability, quality score nếu bật; không bịa ranking.
6. Tool calling hoạt động qua gateway: nhiều tool calls, tool IDs/result matching.
7. Model không có `tools`: **không** chạy Agent tools và không nói đã thực hiện.
8. Model không có image input: trong `single` báo khả năng; trong `task` chọn configured vision model hợp lệ.
9. Sau switching model giữa các bước, conversation/tool result vẫn chuẩn hóa, không mất context.
10. Gmail draft và approval flow vẫn hoạt động; không gửi mail thiếu owner approval.
11. Timeout, 429, 402, bad model ID, provider error có mapping/retry đúng.
12. Cross-model fallback mặc định tắt; provider failover không bị nhầm với model fallback.
13. Privacy ZDR/data-collection policy được áp vào request nếu bật và fail closed khi không khả dụng.
14. Budget policy từ chối đúng và ghi audit.
15. Lưu actual model/usage, token, cost metadata nếu có; không log secrets.
16. Config invalid/missing key/model báo lỗi startup rõ ràng.
17. Zalo polling + OwnerGuard + Redis/BullMQ không bị regression.
18. Không phát sinh LLM classification call trong `single`.

### E2E manual checklist

- [ ] Mở local NestJS, Redis, PostgreSQL.
- [ ] Zalo bot nhận lệnh `/model` và tin nhắn chat thường.
- [ ] `LLM_ROUTING_MODE=single` + model ID từ OpenRouter → chat Zalo thành công.
- [ ] Đổi model ID sang một hãng khác trên OpenRouter → chat tiếp mà không sửa code.
- [ ] `LLM_ROUTING_MODE=task`: chat thường route model A; task Gmail/Tool route model B; image route model C (nếu có capability).
- [ ] Kiểm tra `taskId`, selected model và actual model/usage trong log/DB.
- [ ] `/routing` hiển thị mapping.
- [ ] Thử model free thiếu capability → lỗi rõ, không tool action sai.
- [ ] Gmail draft chờ phê duyệt và chỉ gửi sau approval.

## 14. Files phải tạo/cập nhật

Tùy cấu trúc project, tối thiểu:

```text
.env.example
config/llm-routing.example.json
config/llm-routing.schema.json (hoặc Zod validator)
config/model-evaluations.example.json (chỉ nếu adaptive)
src/modules/llm/**
src/modules/agent/** (chỉ phần tích hợp/router cần sửa)
prisma/schema.prisma + migrations (nếu cần lưu thêm usage/routing)
scripts/llm-validate-routing.ts
scripts/llm-smoke.ts
docs/OPENROUTER_INTEGRATION.md
docs/LLM_ROUTING.md
docs/SECURITY.md
README.md
IMPLEMENTATION_STATUS.md
```

Trong docs phải có:

- Cách tạo OpenRouter API Key, lấy model ID từ https://openrouter.ai/models.
- **Ví dụ cấu hình ngắn cho 2 mode `single` và `task`.**
- Cách lựa model có tools, vision, context lớn.
- Cách thêm task category/mapping mà không sửa Agent Runtime.
- Cách enable adaptive và điều kiện có dữ liệu evaluation.
- Lưu ý giới hạn/quotas model free, 402 hết credits.
- Chính sách privacy, Zero Data Retention, provider routing.
- Cách kiểm chứng selected model và actual model, token usage.
- Cách rollback về config cũ khi migration có lỗi.

## 15. Implementation plan bắt buộc

**Làm theo thứ tự, không chỉ viết plan:**

1. **Audit source hiện tại**: các entrypoints LLM, prompt, tool-call loop, task types, env và test.
2. **Introduce OpenRouter client/gateway**: thay các lệnh gọi LLM mà không đổi Agent semantics.
3. **Single mode end-to-end**: chạy một model thực, unit tests + Zalo chat smoke khi có key.
4. **Task routing (`rules`)**: classifier, config JSON, capability validation, integration.
5. **Usage, cost, limits, security**: trace đầy đủ, safe logging, privacy.
6. **Optional adaptive selection**: chỉ khi module rules đã ổn và có metric thực; nếu không đủ dữ liệu thì để disabled, ghi IMPLEMENTATION_STATUS.
7. **Tests + docs**: typecheck, lint, tests, build, smoke script, migration/rollback instructions.

Sau mỗi phase, cập nhật `IMPLEMENTATION_STATUS.md` với: `DONE`, `IMPLEMENTED_NOT_LIVE_TESTED`, `BLOCKED_BY_CREDENTIALS`, `PARTIAL` hoặc `NOT_STARTED`. Không báo live-tested khi chỉ chạy mock.

## 16. Điều kiện hoàn thành

Dự án đạt yêu cầu khi:

- **Một OpenRouter API Key** gọi được các model khác nhau qua **cùng một gateway**.
- **`single`** là chế độ mặc định, thực sự dùng một model cho mọi suy luận AI trong toàn bộ Agent.
- **`task`** route theo category và mapping/strategy đã cấu hình, không hardcode trong business logic.
- Có validation capability trước khi gọi LLM (đặc biệt Tools/Vision).
- Giữ nguyên quyền truy cập Zalo, Gmail, Memory, Tasks, Files, Approval.
- Mọi provider/model switch có trace để debug.
- Không lộ secrets; không chạy lại action side-effect vì retry.
- Tests/build/lint/typecheck chạy thành công hoặc có lỗi được báo minh bạch.
- Không yêu cầu VPS hoặc dashboard mới để chạy local.

### Câu lệnh bắt đầu

**Hãy bắt đầu ngay bằng việc kiểm tra toàn bộ source hiện tại, xác định đường đi của LLM calls và refactor sang OpenRouter. Ưu tiên hoàn thiện `single` mode hoạt động end-to-end, sau đó triển khai `task` mode có routing rules và các lớp bảo vệ. Không tạo project mới. Không chỉ đưa ví dụ code — hãy sửa trực tiếp file, chạy test và ghi kết quả.**

---

## 17. Tài liệu chính thức để đối chiếu (phải đọc trước khi tích hợp)

- OpenRouter API / Developer Platform: https://openrouter.ai/docs/quickstart và https://openrouter.ai/developers
- Chat Completions: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- Models API: https://openrouter.ai/docs/api/api-reference/models/get-models
- Tool calling: https://openrouter.ai/docs/guides/features/tool-calling
- Routing / Provider selection: https://openrouter.ai/docs/guides/routing/provider-selection
- Model fallback: https://openrouter.ai/docs/guides/routing/model-fallbacks
- Privacy & Zero Data Retention: https://openrouter.ai/docs/guides/features/zdr
- Model Catalog: https://openrouter.ai/models

Nếu đường dẫn docs thay đổi, tìm tài liệu chính thức thay thế và ghi rõ trang đã dùng. Không tự dựng endpoint hoặc giả định tính năng không được xác nhận.
