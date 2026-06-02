# Контент Фабрика

Инструмент для генерации и автоматической публикации постов в VK и Telegram на базе 5-агентного AI-конвейера. Создан для каналов «Я-Инженер» (@club238494545 в VK, @i_am_an_engineer1 в Telegram).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from $PORT, path /api)
- `pnpm --filter @workspace/content-factory run dev` — run the frontend (port from $PORT, path /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `PROXYAPI_KEY`, `VK_ACCESS_TOKEN`, `VK_GROUP_ID`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React 19, Vite, wouter, shadcn/ui, Tailwind CSS
- Publishing: VK API v5.131 + Telegram Bot API

## Where things live

- DB schema: `lib/db/src/schema/posts.ts`
- DB schema (used sources): `lib/db/src/schema/used-sources.ts`
- DB schema (app settings): `lib/db/src/schema/app-settings.ts`
- OpenAPI spec: `lib/api-spec/openapi.yaml`
- API routes: `artifacts/api-server/src/routes/`
- Autopilot route: `artifacts/api-server/src/routes/autopilot.ts`
- VK publisher (scheduled): `artifacts/api-server/src/lib/vk-publisher.ts`
- Telegram publisher: `artifacts/api-server/src/lib/telegram-publisher.ts`
- Auto-generator (Автомат + dedup): `artifacts/api-server/src/lib/auto-generator.ts`
- Autopilot scheduler (12:00 MSK): `artifacts/api-server/src/lib/autopilot-scheduler.ts`
- Frontend pages: `artifacts/content-factory/src/pages/`
- Navigation + layout (Автомат dialog + Autopilot toggle): `artifacts/content-factory/src/components/layout.tsx`

## Architecture decisions

- Contract-first API: OpenAPI YAML → Orval codegen → React Query hooks + Zod schemas. Never hand-write fetch calls on the frontend.
- VK and Telegram publish independently: a failure in one channel does not block the other (except VK failure on immediate publish aborts the request).
- Scheduled publisher polls every 60s via `setInterval`; runs immediately on startup to catch missed posts.
- Posts table uses `scheduledAt` (nullable) to determine when to publish; `publishedAt`, `vkPostId`, and `telegramMessageId` are set after successful publish.
- `VK_GROUP_ID` may be prefixed with "club" — the publisher strips non-numeric chars automatically.

## Product

5-step AI pipeline (Controller → Author → Editor → Critic → Final Editor) generates posts from a topic. Posts can be scheduled to publish at 12:00 MSK on a chosen weekday. Each weekday has a content theme (e.g. Monday = Russian tech, Tuesday = Chinese tech). Upon publishing, posts are sent simultaneously to VK and Telegram. Archive page shows all published posts with VK links and day-theme badges.

## User preferences

- Language: Russian UI, Russian-language posts
- Logging: use `req.log` in routes, `logger` singleton elsewhere — never `console.log` in server code
- Channel: VK group club238494545 (numeric owner_id = -238494545), Telegram @i_am_an_engineer1
- Telegram bot: @my_telegram532_bot ("Толик-админ"), already admin in the channel

## Gotchas

- Do NOT run `pnpm dev` at workspace root — use `restart_workflow` or individual `--filter` commands.
- Verify artifacts with `pnpm --filter @workspace/<slug> run typecheck`, not `build` (build needs PORT/BASE_PATH from workflow env).
- `lucide-react`: use `Calendar` not `CalendarCheck`; `Archive` is available.
- `TELEGRAM_CHANNEL_ID` numeric value: -1002020696562 (but `@i_am_an_engineer1` username works fine in Bot API calls).
- After OpenAPI changes: run `pnpm --filter @workspace/api-spec run codegen` before editing frontend code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- User guide: `GUIDE.md`
- Project README: `README.md`
