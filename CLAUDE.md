# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains multiple TypeScript/React projects primarily located in `Documents\workspace\`. The main active project is **Shook** - a YouTube channel monitoring and Slack notification system that monitors YouTube channels for new videos, generates AI-powered summaries, and delivers them to Slack workspaces.

**Current Working Directory**: `C:\Users\saulpark\Documents\workspace\Shook\` (Windows environment)

## Common Development Commands

### Shook Project (Primary Active Project)
Navigate to: `Documents\workspace\Shook\`

```bash
# Development
npm run dev              # Start both client (Vite) and server (Express) concurrently
npm run dev:client      # Start only the frontend (Vite dev server)  
npm run dev:server      # Start only the backend (Express with tsx watch)

# Build & Production
npm run build           # Build client and server for production
npm run start           # Start production server (requires prior build)

# Database Operations
npm run db:push         # Apply database schema changes using Drizzle

# Type Checking
npm run check           # Run TypeScript compiler to check for type errors

# Installation
npm install             # Install all dependencies
```

### Roving-Through Project
Navigate to: `Documents\workspace\Roving-Through\Roving-Through\`

```bash
npm run dev             # Start development server
npm run build           # Build for production
npm run db:push         # Apply database schema changes
```

### Browser Extensions (Chrome Extensions)
Located at: `Desktop\workspace\` and `Desktop\workspace2\`
- Simple HTML/JS Chrome extensions
- Load as unpacked extensions in Chrome developer mode

## Architecture & Project Structure

### Shook (Main Project) - Full-Stack TypeScript Application

**Tech Stack:**
- Frontend: React 18, TypeScript, Vite, Wouter (routing), Tailwind CSS v4, Shadcn/ui, TanStack Query
- Backend: Node.js, Express.js, TypeScript (ESM), Drizzle ORM, PostgreSQL (Neon)
- Authentication: Passport.js with local strategy (username/password), session-based
- External APIs: YouTube Data API v3, SupaData API, Anthropic Claude API, Slack Web API

**Directory Structure:**
```
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # Reusable components (including shadcn/ui)
│   │   ├── pages/       # Page components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── services/    # API service layer
│   │   └── lib/         # Utilities and configurations
├── server/              # Express backend
│   ├── api/             # API endpoints (Express routers)
│   ├── services/        # Business logic and service instances
│   ├── repositories/    # Data access layer
│   ├── lib/             # Shared utilities and configurations
│   └── utils/           # General utility functions
├── shared/              # Shared database schema (Drizzle ORM)
└── package.json         # Monorepo dependencies and scripts
```

**Key Backend Architecture:**
- **Modular API Routes**: Each feature has its own router file in `server/api/`
- **Service Layer**: Business logic separated into services with singleton pattern
- **Repository Pattern**: Data access abstracted in repositories (`server/repositories/storage.ts`)
- **Background Monitoring**: YouTube RSS feed monitoring service runs every 5 minutes
- **Error Logging**: Centralized error logging service that sends errors to Slack
- **Session Management**: PostgreSQL-backed sessions with connect-pg-simple

**Critical Architectural Patterns:**
- **YouTube Monitoring Pipeline**: RSS parsing → Content filtering (no Shorts) → Transcript extraction → AI summarization → Slack delivery
- **Channel Lifecycle Management**: Auto-cleanup of `youtube_channels` when no users remain subscribed
- **Service Dependencies**: YouTubeMonitor depends on YouTubeSummaryService and SlackService
- **Error Recovery**: Comprehensive error handling with Slack notifications for all service failures

**Database Schema (PostgreSQL with Drizzle ORM):**
- `users` - User accounts with Slack integration (slackUserId, slackChannelId, slackJoinedAt)
- `youtube_channels` - Shared channel metadata with video tracking (recentVideoId, processed, caption)
- `user_channels` - Many-to-many subscription mapping with auto-cleanup logic
- `session` - PostgreSQL session store for authentication

### Development Environment Configuration

**TypeScript Configuration:**
- Monorepo setup with path aliases: `@/*` for client, `@shared/*` for shared
- Strict mode enabled with ESNext modules
- Bundle resolution for Vite compatibility

**Vite Configuration:**
- React plugin with runtime error overlay (@replit/vite-plugin-runtime-error-modal)
- API proxy to Express backend on port 3000 (`/api/*` routes)
- Path aliases matching TypeScript configuration (`@/*`, `@shared/*`)
- Tailwind CSS v4 with @tailwindcss/vite plugin
- Special handling for Replit deployment (cartographer plugin)

**Database Configuration:**
- Drizzle ORM with PostgreSQL dialect and Neon serverless driver
- Schema defined in `shared/schema.ts` with Zod validation schemas
- Push-based migrations (no SQL migration files) - use `npm run db:push`
- Connection pooling through @neondatabase/serverless

## External Service Integration

### API Keys Required (Environment Variables)
```
DATABASE_URL=postgresql://...           # Neon PostgreSQL connection
SESSION_SECRET=random_string           # Session encryption
YOUTUBE_API_KEY=google_cloud_key      # YouTube Data API v3
ANTHROPIC_API_KEY=claude_api_key      # Claude AI for summarization  
SLACK_BOT_TOKEN=xoxb-...              # Slack Bot OAuth token
SLACK_CHANNEL_ID=debug_channel        # For error logging
```

### API Usage Patterns
- **YouTube Data API**: Channel search, metadata retrieval, RSS feed parsing (10K daily quota)
- **SupaData API**: Video transcript/caption extraction with retry logic (rate limited)
- **Anthropic Claude API**: AI-powered video summarization in Korean using Claude Sonnet 4
- **Slack Web API**: Bot integration for user invites, private channel creation, formatted message posting

## Development Guidelines

### Database Management
- **Never write raw SQL migrations** - modify `shared/schema.ts` and run `npm run db:push`
- Schema changes are push-based using Drizzle Kit
- Be cautious of data loss warnings during schema changes

### Error Handling & Monitoring
- All service errors automatically sent to Slack debug channel
- Use centralized error logging service in `server/services/error-logging-service.ts`
- Implement proper error boundaries in React components

### Code Patterns
- **React**: Use TanStack Query for server state, React Hook Form + Zod for forms, Wouter for routing
- **Frontend Architecture**: Custom hooks for domain logic, service layer for API calls, Shadcn/ui for components
- **Backend**: Express routers with middleware stack (auth → authorization → business logic)
- **Service Layer**: Singleton pattern with dependency injection, centralized error handling
- **Database**: Drizzle ORM with type-safe queries and relations, no raw SQL
- **Authentication**: Session-based auth with Passport.js local strategy and PostgreSQL session store

### External API Considerations
- Monitor API quotas (YouTube has 10K daily limit)
- Handle rate limiting (429 errors) with retry logic
- Implement graceful degradation when APIs are unavailable
- Never commit API keys - use environment variables only

## Testing & Quality

- TypeScript strict mode enforced across the codebase
- Run `npm run check` to verify TypeScript compilation
- No formal test framework currently configured
- Manual testing required for external API integrations

## Deployment Notes

### Production Build Process
```bash
npm run build    # Vite build (client) + esbuild (server) 
npm run start    # Starts production server
```

**Build Architecture:**
- **Client Build**: Vite builds React app to `dist/public/` (static assets)
- **Server Build**: esbuild bundles Express app to `dist/server/index.js` (ESM format)
- **Asset Serving**: Production Express server serves Vite-built static files
- **Environment**: Production build uses NODE_ENV=production with optimizations

### Docker Support
- Dockerfile and docker-compose.yml present in Shook project
- Multi-stage build for optimized container size
- Supports containerized deployment with proper environment variable injection
- Production container runs on port 3000

### Background Services & Production Considerations
- **YouTube Monitoring**: Service must run continuously with 5-minute intervals
- **Database**: Neon serverless with connection pooling (no manual connection management)
- **Session Management**: Persistent PostgreSQL-backed sessions survive server restarts
- **Process Management**: Consider PM2 for production process management and auto-restart

## Common Issues & Troubleshooting

1. **API Quota Exceeded**: YouTube API 403 errors - check Google Cloud Console quotas
2. **Database Connection Issues**: Verify DATABASE_URL and Neon database status  
3. **Slack Integration Problems**: Check bot permissions and token validity
4. **Build Failures**: Run `npm run check` for TypeScript errors first
5. **Vite Proxy Issues**: Backend must be running on port 3000 for development

## File Patterns & Locations

**Primary Project Location**: `C:\Users\saulpark\Documents\workspace\Shook\` (Windows environment)

**Key Configuration Files:**
- `tsconfig.json` - Monorepo TypeScript configuration with path aliases
- `vite.config.ts` - Frontend build and development proxy configuration  
- `drizzle.config.ts` - Database ORM configuration and schema management
- `package.json` - ESM module configuration with concurrency scripts
- `shared/schema.ts` - Drizzle database schema with Zod validation
- `.env` - Environment variables (not committed, use `.env.example` as template)

**Other Projects** (secondary/inactive):
- `Documents\workspace\Roving-Through\Roving-Through\` - Similar stack with different domain
- `Desktop\workspace\` and `Desktop\workspace2\` - Simple Chrome extensions

## YouTube Monitoring Service Architecture

**Core Processing Pipeline:**
1. **RSS Polling**: Fetch XML feeds every 5 minutes for all subscribed channels
2. **Content Filtering**: Skip YouTube Shorts, process only regular video uploads  
3. **Change Detection**: Compare new video IDs with stored `recentVideoId` in database
4. **Transcript Extraction**: Use SupaData API to get video captions/transcripts
5. **AI Summarization**: Generate Korean summaries using Anthropic Claude API
6. **Slack Delivery**: Send formatted notifications to user's private Slack channels
7. **State Persistence**: Update database with processing state and results

**Error Handling Strategy:**
- All service errors automatically logged to designated Slack debug channel
- Graceful degradation when external APIs are unavailable
- Retry logic for transient failures with exponential backoff
- Detailed error context (service, operation, user ID, additional metadata)