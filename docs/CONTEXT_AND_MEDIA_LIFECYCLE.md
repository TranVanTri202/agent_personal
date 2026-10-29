# Context & Media Lifecycle Architecture

This document describes the complete lifecycle of conversation context, user-uploaded media, and assistant-generated media within the Personal AI Agent system.

---

## 1. End-to-End Pipeline Overview

```
 ┌─────────────────────────┐
 │   Zalo Inbound Event    │
 │ (Webhook / Polling SDK) │
 └────────────┬────────────┘
              │ 1. Raw Payload
              ▼
 ┌─────────────────────────┐
 │  ZaloEventNormalizer    │ ── Extracts chatId, senderId, text/caption,
 └────────────┬────────────┘    imageUrl, attachments[], replyToMessageId
              │ 2. Normalized Message
              ▼
 ┌─────────────────────────┐
 │      AgentService       │
 └────────────┬────────────┘
              │ 3. Media Ingestion & Save Message
              ├──────────────────────────────────────────────┐
              ▼                                              ▼
 ┌─────────────────────────┐                    ┌─────────────────────────┐
 │   ConversationsService  │                    │   ImageContextService   │
 │   - saves Message with  │                    │   - downloads image     │
 │     epoch filter        │                    │   - saves to Supabase   │
 └─────────────────────────┘                    │     temp storage (24h)  │
                                                │   - inserts StoredFile  │
                                                │     with conversationId │
                                                │   - updates ConvState   │
                                                └────────────┬────────────┘
                                                             │
              ┌──────────────────────────────────────────────┘
              ▼
 ┌─────────────────────────┐
 │ ContextResolverService  │ ── Resolves:
 │                         │    • Reply-to references
 │                         │    • Pronouns ("ảnh đó", "gửi lại coi")
 │                         │    • Ordinals ("ảnh thứ nhất", "cái thứ 2")
 │                         │    • Group vs Private Security Scope
 └────────────┬────────────┘
              │ 4. Augmented context & Tool Instructions
              ▼
 ┌─────────────────────────┐
 │     Agent LLM Loop      │ ── OpenRouter / Mock LLM
 └────────────┬────────────┘
              │ 5. Tool Call(s) (Supports Multi-intent in 1 turn)
              ├──────────────────────────────┬──────────────────────────────┐
              ▼                              ▼                              ▼
 ┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
 │  analyze_existing_image │    │  resend_existing_media  │    │       edit_image        │
 │  - checks Vision support│    │  - checks 24h TTL       │    │  - loads source image   │
 │  - caches OCR / summary │    │  - resolves fresh URL   │    │  - applies OpenRouter   │
 │  - zero hallucination   │    │  - calls sendPhoto()    │    │    editing prompt       │
 └────────────┬────────────┘    └────────────┬────────────┘    └────────────┬────────────┘
              │                              │                              │
              └──────────────────────────────┴──────────────────────────────┘
                                             │ 6. Outbound Action & Reply
                                             ▼
                                ┌─────────────────────────┐
                                │   ZaloApiClient Output  │
                                │   - sendPhoto           │
                                │   - sendMessage         │
                                └─────────────────────────┘
```

---

## 2. Media Ingestion & 24h TTL Lifecycle

1. **Upload & Download:**
   - Incoming image events contain a source URL from Zalo CDN.
   - `ImageContextService.recordIncomingUserImage` fetches the image binary stream safely via SSRF-validated HTTP client.
2. **Storage Persistence:**
   - Saved to Supabase bucket `agent_personal` under `temp/conv-{conversationId}/zalo-input-{timestamp}.jpg`.
   - Stored in database table `StoredFile`:
     - `conversationId`: Linked to the current conversation (crucial for context resolution).
     - `ownerId`: Linked to the user who uploaded the media.
     - `source`: `'incoming'` (or `'generated'` for assistant outputs).
     - `originalMessageId`: The external message ID from Zalo.
     - `retentionHours`: 24 hours.
     - `status`: `'ACTIVE'`.
3. **Automated Expiration:**
   - A BullMQ delayed job is scheduled for `now() + 24 hours` (`temp-storage-cleanup` queue).
   - In addition, `TempStorageSweeperService` runs every hour to remove any expired files where `status = 'ACTIVE'` and `createdAt < now() - 24 hours`.
   - Expired files are deleted from Supabase storage and their DB status is updated to `'EXPIRED'`.
   - Any subsequent call to `resend_existing_media` or `analyze_existing_image` detects expired/missing media and replies politely without hallucination or broken links.

---

## 3. Context Resolution Pipeline

The `ContextResolverService` inspects the user's raw text and active conversation state before passing context to the LLM:

| Resolution Category | Trigger Phrases | Resolution Strategy |
| :--- | :--- | :--- |
| **Direct Reply-to** | Zalo quote message | Retrieves `repliedMsg` by `replyToMessageId`; extracts linked image or file ID directly. |
| **Demonstrative Pronoun** | "ảnh đó", "ảnh này", "hình đó", "gửi lại coi", "xem lại" | Retrieves `lastImageIds[0]` from active conversation state or the most recent `StoredFile` in PostgreSQL. |
| **Ordinal Matching** | "ảnh thứ nhất", "cái thứ 2", "ảnh đầu", "tam thu 3" | Regex matches index (1-based), resolves to `imagePool[idx]`. |
| **Ambiguous Clarification** | "Nhắc tôi đi họp lát nữa", "chiều mai nhắc tôi" | Detects missing exact time slot, records `pendingClarification` and asks polite clarification without creating dummy task. |
| **Security Scope** | Group chat access | Blocks private owner emails, private reminders, and private media from leaking into group chat. |

---

## 4. Multi-Intent Turn Execution

When a user submits a compound prompt, such as:
> *"Ảnh đó có thông tin gì? Gửi lại coi."*

The agent executes multiple tools sequentially within the same turn:
1. **Tool 1: `analyze_existing_image`**:
   - Checks if the selected model / gateway supports multimodal vision (`isVisionSupported`).
   - If supported: calls OpenRouter vision API and caches `analysisSummary`.
   - If unsupported: returns `{ success: false, isVisionSupported: false, error: 'GATEWAY_NOT_CONFIGURED' }`. It **never** hallucinates a fictional description.
2. **Tool 2: `resend_existing_media`**:
   - Verifies the image exists in `StoredFile` and is within the 24h retention period.
   - Generates a fresh download link.
   - Dispatches `zaloClient.sendPhoto(chatId, photoUrl, caption)` to resend the photo back into the chat.
3. **Response Assembly (Partial Success):**
   - The agent conveys that the photo has been resent, while reporting transparently that vision OCR is currently unavailable.

---

## 5. Ephemeral Context Reset (`/clear`)

The `/clear` command provides an instant reset of the conversation context without requiring LLM inference:
- **Action:** Increments `conversationEpoch` in both `Conversation` and `ConversationState`.
- **Effect on Message History:** Messages saved in previous epochs are omitted from subsequent LLM context assembly (`getRecentMessages(conversationId)` filters by `epoch = currentEpoch`).
- **Effect on Active References:** Active references (`lastImageIds`, `lastFileIds`, `lastReminderId`, `pendingClarification`) are cleared.
- **Data Protection:** Does **not** touch user profile, stored credentials, active reminders, background BullMQ jobs, or physical files in storage.
