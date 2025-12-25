# Repository Guidelines

## Project Structure & Module Organization
- `server/` holds the Express API (`server/index.ts`), with route handlers in `server/api/`, business logic in `server/services/`, data access in `server/repositories/`, and shared helpers in `server/utils/` and `server/lib/`.
- `shared/` contains the Drizzle schema (`shared/schema.ts`) shared by the server.
- `public/` serves static documents (privacy policy, terms).
- `scripts/` stores SQL helpers such as `scripts/create-indexes.sql`.
- Generated output lives in `dist/` (do not edit). Configuration lives in `drizzle.config.ts`, `Dockerfile`, `docker-compose*.yml`, and `.env.example`.

## Build, Test, and Development Commands
- `npm run dev`: run the API locally with hot reload via `tsx`.
- `npm run build`: bundle the server into `dist/server/` using esbuild.
- `npm run start`: start the production build from `dist/server/index.js`.
- `npm run check`: TypeScript type-check only (no emit).
- `npm run db:push`: push Drizzle schema changes to PostgreSQL.
- `docker compose up --build`: optional containerized run (reads `.env`).

## Coding Style & Naming Conventions
- TypeScript (ESM) with 2-space indentation and semicolons; match the formatting used in `server/*.ts`.
- Keep runtime imports using `.js` extensions (e.g., `./services/index.js`) to align with ESM output.
- Use `camelCase` for variables/functions, `PascalCase` for types/classes, and kebab-case for filenames.

## Testing Guidelines
- No automated test runner is configured, and `tsconfig.json` excludes `**/*.test.ts`.
- Use `npm run check` for the current verification step.
- If you add tests, place them under `server/` or `shared/` with `*.test.ts` names and add a test script/tool before relying on them.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) as seen in Git history.
- PRs should include a short summary, linked issue (if any), verification steps, and note any new env vars or migrations. Add screenshots only when `public/` pages change.

## Security & Configuration Tips
- Store secrets in `.env`; update `.env.example` when introducing new keys.
- Core config keys include `DATABASE_URL`, `SESSION_SECRET`, `YOUTUBE_API_KEY`, `OPENAI_API_KEY`, and `PORT`.
