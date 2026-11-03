# PROMPT — MIGRATE EXISTING NESTJS PERSONAL AI AGENT TO `zalo-bot-js`

## 0. Mission

You are a senior NestJS / TypeScript engineer. **Modify the existing repository in place**. The project is a **Personal AI Agent using Zalo Official Bot**, OpenRouter, PostgreSQL, Redis/BullMQ, Gmail, Memory, tasks, AI tool calling, progress notifications, sticker collection and smart sticker replies.

**Goal:** Replace the custom Zalo Official Bot HTTP transport and hand-written polling/event dispatch with the maintained public TypeScript SDK [`KaiyoDev/zalo-bot-js`](https://github.com/KaiyoDev/zalo-bot-js), **without changing any working business behavior**. Do not create a new application, rewrite the AI runtime, or switch to `zca-js`. This is the Official Bot API SDK, not an SDK for a personal Zalo account.

### Non-negotiable constraints

1. Inspect the actual source tree, `.env.example`, package manager, dependency versions, test suite, and existing Zalo implementation **before editing**. Identify all send/receive call sites.
2. Read the SDK's README, docs, TypeScript declarations, relevant source and release/version before adopting each method. Use actual installed signatures, not invented method names or event payloads.
3. **Keep one and only one receiver** for a bot token: local SDK long polling OR production webhook. No concurrent old HTTP polling and new SDK polling; no duplicate event handlers.
4. Preserve OpenRouter single/task model selection, agent loop, tool registry, Gmail OAuth, approval/permissions, task state, BullMQ, storage, memory, existing sticker features and current response personality.
5. Never touch actual credentials. Use existing `ZALO_BOT_TOKEN`, mode and webhook settings; do not add unnecessary environment variables.
6. Do not assert that a method works merely because the SDK exposes it. Distinguish documented SDK method, official Zalo API support, and confirmed integration test results.
7. Build, lint, typecheck, unit/integration-test; document untested features and credentials required. No live destructive operations without explicit approval.

## 1. Initial audit: capability matrix

Find every feature currently implemented using HTTP, for example:

- `getMe`, `getUpdates`, `sendMessage`, `sendPhoto`, `sendSticker`, `sendVoice`, `sendChatAction`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`.
- Receive text, photos, stickers, voice, commands and group mentions/replies if present.
- Sticker library in PostgreSQL, manual `config/stickers.json` imports, random emotion stickers, `/sticker-add <emotion>`, `/sticker-done`, `/sticker-list`, `/sticker-status`, `/sticker-cancel`, `/sticker-test`, `/sticker-help`.
- Ack immediately on long task, true progress updates, success/failure status, typing signals, splitting long messages, file delivery via signed Cloudflare R2 URL.
- Private owner pairing/allowlist, group sender checks, access control, idempotency and error handling.

Before editing, create a short audit listing **current implementation -> SDK API -> migration strategy -> risks**. If an existing feature is implemented but no trustworthy SDK equivalent exists, preserve the existing integration behind the adapter only if the endpoint is documented and functional, rather than silently deleting it.

## 2. Install SDK

Use the project package manager; install and pin a tested version:

```bash
npm install zalo-bot-js
```

Verify Node compatibility, package exports, TypeScript typing, event APIs, and transitive requirements. Keep old HTTP libraries if other modules need them; remove only unneeded Zalo-specific wrappers after migration tests pass.

## 3. ZaloChannelAdapter (SDK behind an interface)

Define a stable application-owned interface; adapt to existing names rather than duplicate APIs:

```ts
export interface IZaloChannel {
  sendText(chatId: string, text: string, opts?: { replyToMessageId?: string }): Promise<unknown>;
  sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<unknown>;
  sendSticker(chatId: string, stickerId: string): Promise<unknown>;
  sendTyping(chatId: string): Promise<unknown>;
  sendVoice(chatId: string, voiceUrl: string): Promise<unknown>;
  sendFileLink(chatId: string, signedUrl: string, fileName: string): Promise<unknown>;
}
```

Actual SDK signatures must be verified; for example, the README documents `sendPhoto(chatId, caption, url, opts?)`, so do **not** assume `sendPhoto(chatId, url, caption)` at the SDK boundary. The adapter maps application arguments to SDK arguments correctly.

Provide one injectable singleton `Bot` instance through NestJS DI; never construct a new `Bot` per message. Map and sanitize SDK errors; handle timeout/backoff. Ensure message chunking, sanitized logging, delivery errors, and retry safety.

Keep the generic channel interface so other channels can be added later. Business services (Agent, Sticker, Tasks, Gmail) must not import `Bot` or `zalo-bot-js` directly.

## 4. SDK long polling (local)

When existing mode is `polling`:

- Initialize bot (`getMe`/`initialize`) and attach handlers exactly once.
- Start SDK `startPolling()` in one designated process (not once per NestJS worker/container).
- No separate custom HTTP `getUpdates` loop.
- On `onModuleDestroy` / OS signals, call `stopPolling()` then `shutdown()` as appropriate.
- If webhook exists, clearly diagnose incompatibility; do not silently delete a production webhook from startup.
- Retain event deduplication and existing database/queue handoff; use external update/message ID suitable for idempotency.
- Do not run expensive AI calls inside receive loop; enqueue work quickly.

SDK README API: `on('message'|'text'|'photo'|'sticker'|'command', cb)`, `onText`, `command`, `startPolling`, `stopPolling`, `getPollingState`, `onError`. **Check double-dispatch**: a `message` event may also trigger `text` and `command`; route every external message through a single canonical normalized message pipeline, and process it only once.

## 5. SDK webhook (production)

When mode is `webhook`:

- Keep existing secure NestJS HTTP endpoint, verify `x-bot-api-secret-token` against configured secret, check content type/size, validate payload and record receipt safely.
- Pass the verified payload to `bot.processUpdate(payload)`, then to the **same** normalized processing pipeline.
- Do not run polling in this mode.
- Use SDK `setWebhook`, `deleteWebhook`, `getWebhookInfo` only through explicit CLI/admin action, not automatically at every startup.
- Return the appropriate fast HTTP acknowledgement and enqueue work; handle duplicate delivery.

## 6. Normalized events: preserve AI and sticker behavior

Do not expose SDK `Message` objects directly to Agent Runtime. Normalize fields consistently:

```ts
interface IncomingMessage {
  channel: 'zalo';
  externalMessageId: string;
  externalUpdateId?: string;
  chatId: string;
  chatType: 'PRIVATE' | 'GROUP' | 'UNKNOWN';
  senderId: string;
  text?: string;
  stickerId?: string;
  imageUrl?: string;
  voiceUrl?: string;
  receivedAt: Date;
  rawPayload?: unknown; // secure, size-limited, retention-aware
}
```

SDK documented model properties include `message.messageId`, `message.chat.id`, `message.chat.type`, `message.fromUser?.id`, `message.text`, `message.sticker`, `message.photoUrl`, and `metadata.update.updateId`. Verify real properties with installed SDK and fixtures. Voice/media support may need raw event inspection: never pretend SDK provides a parsed field when it does not.

Route messages in this order:

1. Validate dedupe and sender permissions.
2. Parse admin commands.
3. If sticker collection is active, save incoming sticker and short-circuit AI.
4. For authorized normal input, enqueue AI task and send immediate acknowledgement.
5. Show meaningful task progress, final result, or clear error.

## 7. Sticker collector and smart sticker replies (must remain working)

Preserve commands:

- `/sticker-add sorry` → enter collection session for emotion `sorry`.
- Send many stickers → extract real sticker IDs from events; dedupe; store durably in PostgreSQL; acknowledge when useful.
- `/sticker-done` → end session and report actual added count.
- `/sticker-status`, `/sticker-list`, `/sticker-cancel`, `/sticker-test sorry`, `/sticker-help`.

Only the owner can manage the library. Never feed sticker command messages into LLM. Preserve support for manually added IDs in `config/stickers.json` if currently present.

During ordinary conversations, the AI can suggest an emotion and decide whether a sticker is appropriate; backend selects a random valid ID within the emotion group, avoiding immediate repetition where possible. **No sticker feature env toggles, artificial cooldowns, or quotas.** Do not send stickers after every reply or in sensitive/serious situations. Use SDK `sendSticker()`.

## 8. Existing personality and progress messaging

Preserve user's requested Vietnamese personality: polite, natural `Dạ`/`Vâng ạ`, friendly and occasionally witty, professional for serious contexts. No repetitive scripted acknowledgements.

For long operations:

- Immediate ACK when task accepted.
- Progress messages tied to actual state changes, e.g. "đã tải được 20 email, đang phân loại" only when evidence confirms those facts.
- Typing action via SDK as appropriate, without relying on typing as the only progress indicator.
- Completion with result, or failure/cancellation with reason and next step.
- Avoid message floods; prefer meaningful progress milestones but do not arbitrarily suppress important status.

## 9. SDK features: capabilities and limitations

SDK README advertises:

- `sendMessage`, `sendPhoto`, `sendPhotos` (sequential), `sendSticker`, `sendVoice` (private chat AAC), `sendChatAction`.
- Some advanced methods: `editMessageText`, `deleteMessage`, `pinMessage`, `unpinMessage`, group-admin/ban methods, keyboard, upload and file info helpers.

**Do not enable advanced methods based only on names.** First verify official Zalo Bot API support with live safe test or clear official docs. They can return unsupported errors even if present in SDK. Preserve signed storage URL delivery for PDFs, ZIPs and videos unless a supported method is verified.

No confirmed native @mention-user/@all or reaction method in the SDK; never claim sending `@Name` text sends a real mention. Preserve `reply_to_message_id` only if actual send endpoint supports it; test notification behavior separately.

Keep a capability map and graceful unsupported response for unavailable actions.

## 10. Reliability and security

- One Bot singleton, one active receiver mode.
- Owner identity and group sender checked before AI/tool invocation.
- No secret/token in logs, errors, progress messages or VCS.
- Prevent command/text/sticker event double handling.
- Database uniqueness for external message/update IDs; retries must not repeat Gmail send, write tool, or other side effect.
- Retry only safe transient errors; don't blindly resend a message when success is ambiguous.
- Restore task processing after restart without losing queue state.
- No new .env variables unless technically unavoidable; document any genuinely necessary one.

## 11. Tests / acceptance

Add mock-based and integration tests for:

1. SDK startup/shutdown, only one polling instance.
2. Webhook security and `processUpdate` dispatch.
3. Receive text, command, sticker and photo; handle voice if supported.
4. No event duplication when overlapping SDK listeners fire.
5. Owner-only access in private/group chats.
6. `/sticker-add sorry` → multiple sticker messages → `/sticker-done` → `/sticker-test sorry`.
7. Correct SDK argument order for photo, text, voice and sticker.
8. ACK + real progress + completion and error paths.
9. AI Agent -> OpenRouter -> tools -> response delivery unchanged.
10. Signed URL delivery for documents/videos.
11. Single message execution across reconnect/retry/restart.
12. SDK failure handling, logging and graceful shutdown.

Run lint, typecheck, build and tests. Do not claim live Zalo test passed unless actually performed with valid credentials and operator authorization.

## 12. Documentation and final reporting

Update `README.md`, `.env.example`, `docs/ZALO_INTEGRATION.md`, and `IMPLEMENTATION_STATUS.md` (or equivalents). Include:

- SDK version pinned, installed runtime requirements.
- `ZALO_MODE=polling` local run instructions; `ZALO_MODE=webhook` production instructions.
- Confirmed capabilities vs unverified SDK-only methods vs unsupported methods.
- Before/after call-site mapping and removed redundant HTTP code.
- Results of tests and exact commands to reproduce them.
- Existing functionality preserved and any remaining blockers.

**Start now:** audit existing repository, create a migration plan, edit code in place, and test. Do not stop at writing documentation. Do not rewrite any non-Zalo business logic unnecessarily.
