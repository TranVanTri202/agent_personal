# OpenRouter Gateway Integration

## 1. Overview
The **Personal Zalo AI Agent** uses [OpenRouter](https://openrouter.ai) as its primary LLM gateway. With a single `OPENROUTER_API_KEY`, the agent can route conversations and background tasks across hundreds of state-of-the-art AI models (Claude 3.5 Sonnet, GPT-4o, GPT-4o-mini, Gemini 1.5/2.5, DeepSeek V3/R1, and open-source models).

## 2. Gateway Architecture
```
                         +-----------------------+
                         | Zalo Bot / Background |
                         +-----------+-----------+
                                     |
                                     v
                       +---------------------------+
                       |      AgentService         |
                       +-------------+-------------+
                                     |
                                     v
                       +---------------------------+
                       |   TaskClassifierService   |
                       |  (Detects Category: chat, |
                       |   tool_calling, coding...) |
                       +-------------+-------------+
                                     |
                                     v
                       +---------------------------+
                       |     LLMRoutingService     |
                       |  - Mode: single vs task   |
                       |  - Checks model capability|
                       +-------------+-------------+
                                     |
                                     v
                       +---------------------------+
                       |     OpenRouterGateway     |
                       |  - Budget enforcement     |
                       |  - Retry with backoff     |
                       |  - Error mapping          |
                       |  - DB usage logging       |
                       +-------------+-------------+
                                     |
                                     v
                         https://openrouter.ai/api/v1
```

## 3. Operational Modes

### Mode A: `single` (Default)
- **Environment Setting:** `LLM_ROUTING_MODE=single`
- **Model:** Defined by `LLM_SINGLE_MODEL` (e.g. `openai/gpt-4o-mini` or `anthropic/claude-3.5-sonnet`).
- **Behavior:** 100% of tasks, chats, and internal reasoning steps bypass any category mapping and route directly to `LLM_SINGLE_MODEL`.
- **Capability Check:** Before dispatching, the gateway validates that the model supports required features (such as `tools` or `vision`). If not supported, the gateway raises an explicit `OpenRouterCapabilityError` to inform the user instead of silently failing or secretly switching models.

### Mode B: `task`
- **Environment Setting:** `LLM_ROUTING_MODE=task`
- **Configuration File:** `config/llm-routing.json`
- **Strategy:** `rules` (deterministic mapping) or `adaptive` (evaluations profile).
- **Behavior:** The agent classifies each incoming turn into one of 13 task categories and routes to the best model configured for that category. If a category is unmapped, it gracefully falls back to `LLM_DEFAULT_MODEL`.

## 4. Error Handling & Resilience
The gateway maps OpenRouter HTTP status codes into structured domain errors:
- **`401` Unauthorized:** Invalid or missing `OPENROUTER_API_KEY`.
- **`402` Insufficient Credits:** Account balance exhausted.
- **`403` Content Policy:** Policy violation or blocked content.
- **`404` Model Not Found:** Specified model ID does not exist in OpenRouter.
- **`429` Rate Limit:** Rate-limited; automatically retried with exponential backoff.
- **`5xx` Provider / Server Outage:** Server errors; retried up to `LLM_MAX_RETRIES`.
- **`OpenRouterCapabilityError`:** Model lacks required tools or vision capabilities.

## 5. Budget & Cost Enforcement
- **`LLM_DAILY_BUDGET_USD`:** Daily spending cap. When exceeded, the agent halts non-essential LLM calls and alerts the owner.
- **`LLM_MAX_OUTPUT_TOKENS`:** Caps generation length per request (default: 4096).
- **`LLMUsageLog` Table:** Every request automatically records:
  - `taskId`, `conversationId`, `ownerId`
  - `routingMode` (`single` / `task`)
  - `taskCategory` (`chat`, `coding`, `gmail_read`, etc.)
  - `requestedModel` and `actualModel`
  - `promptTokens`, `completionTokens`, `totalTokens`
  - `costUsd` (exact cost provided by OpenRouter)
  - `latencyMs`

## 6. CLI Management Commands
- **Validate routing:** `npm run llm:validate-routing`
- **List available models & capabilities:** `npm run llm:list-models`
- **Smoke test OpenRouter connectivity:** `npm run llm:smoke`
- **System diagnostic:** `npm run doctor`
