# MTProto Moderator (TypeScript)

Single-codebase Telegram moderation runtime using:

- Bot API business automation for inbound DMs and outbound warnings
- Lazy GramJS (MTProto) sessions for onboarding auth and `contacts.Block` only
- Management bot (Telegraf) for onboarding
- Deterministic auto-moderation flow (no AI)
- PostgreSQL persistence
- Composition root DI in `src/root.ts`

## Quick start

1. Copy `.env.example` to `.env` and fill required values.
2. Install dependencies: `npm install`
3. Start runtime: `npm run dev`
4. In Telegram, send `/start` to the mgmt bot and complete onboarding flow.
5. When prompted, open the secure auth link and submit login code / 2FA there.

## Ops scripts

- `npm run ops:create-db` initializes PostgreSQL tables from `assets/db.sql`.

## Core flow

1. User onboards via mgmt bot (phone -> login code -> optional 2FA password)
2. Session string is persisted per user
3. Incoming direct user message via business automation (Bot API)
4. First message from a sender gets a warning reply via the management bot
5. Second message gets a final warning; third+ triggers block (`contacts.Block` via lazy GramJS)
6. Mgmt bot notifies the onboarded client account so they can unblock if needed
