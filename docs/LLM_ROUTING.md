# LLM Routing & Multi-Model Architecture

## 1. Task Categories
The routing engine recognizes 13 distinct task categories:

| Category | Description | Primary Requirement |
|---|---|---|
| `chat` | General conversation and casual Q&A | Fast latency, good coherence |
| `intent_classification` | Determining user intents | Structured classification |
| `planning` | Goal decomposition and step-by-step strategy | Deep reasoning, tool awareness |
| `tool_calling` | Agent loop executing system tools | Function / Tool Calling support |
| `general_reasoning` | In-depth analysis and problem solving | High benchmark score |
| `gmail_read` | Fetching and parsing email messages | Fast reading, large context |
| `gmail_summary` | Digesting long email threads | Summarization competence |
| `gmail_draft` | Drafting professional email replies | High writing quality |
| `document_summary` | Summarizing PDF, Word, text files | Long context window |
| `document_extraction` | Extracting structured data from files | Structured outputs / JSON mode |
| `coding` | Writing and debugging scripts/code | High HumanEval / SWE benchmark |
| `image_understanding` | Inspecting images and photos | Multimodal / Vision support |
| `translation` | Multilingual translation | Multilingual fluency |

---

## 2. Configuration: `config/llm-routing.json`

Example configuration:
```json
{
  "version": 1,
  "strategy": "rules",
  "defaultModel": "openai/gpt-4o-mini",
  "taskModels": {
    "chat": "openai/gpt-4o-mini",
    "intent_classification": "openai/gpt-4o-mini",
    "planning": "anthropic/claude-3.5-haiku",
    "tool_calling": "openai/gpt-4o-mini",
    "general_reasoning": "anthropic/claude-3.5-haiku",
    "gmail_read": "google/gemini-flash-1.5",
    "gmail_summary": "google/gemini-flash-1.5",
    "gmail_draft": "openai/gpt-4o-mini",
    "document_summary": "google/gemini-flash-1.5",
    "document_extraction": "openai/gpt-4o-mini",
    "coding": "deepseek/deepseek-chat",
    "image_understanding": "openai/gpt-4o-mini",
    "translation": "openai/gpt-4o-mini"
  },
  "requirements": {
    "tool_calling": ["tools"],
    "image_understanding": ["image_input"],
    "document_extraction": ["structured_output"]
  },
  "modelAllowlist": [
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-haiku",
    "google/gemini-flash-1.5",
    "deepseek/deepseek-chat"
  ],
  "modelDenylist": [],
  "adaptive": {
    "enabled": false,
    "profile": "balanced",
    "candidateModelsByTask": {},
    "qualityScoresSource": "./config/model-evaluations.json"
  }
}
```

---

## 3. Environment Variable Overrides
Specific task categories can be overridden in `.env` without modifying the JSON file:
```env
LLM_TASK_MODEL_CODING="deepseek/deepseek-chat"
LLM_TASK_MODEL_PLANNING="anthropic/claude-3.5-sonnet"
LLM_TASK_MODEL_GMAIL_READ="google/gemini-flash-1.5"
```

---

## 4. Zalo Admin Commands (Owner Only)
The paired owner can inspect and manage LLM routing directly from Zalo chat:

- **`/model`**: Shows current routing mode, active model, and default fallback.
- **`/routing`**: Displays full category-to-model routing table.
- **`/models`**: Shows cached model catalog and capabilities (Tools, Vision).
- **`/ai-usage`**: Shows daily token counts, request count, and USD spend.
- **`/ai-health`**: Tests live connectivity to OpenRouter and reports response latency.
