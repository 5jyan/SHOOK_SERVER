# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains the **Shook Server** - a backend API service that monitors YouTube channels for new videos and generates AI-powered summaries. This is a server-only project built with Node.js/Express and TypeScript.

**Current Working Directory**: `C:\Users\saulpark\Documents\workspace\shook_server\` (Windows environment)

## Common Development Commands

```bash
# Development
npm run dev              # Start development server with tsx watch (hot-reload)

# Build & Production
npm run build           # Build server for production using esbuild
npm run start           # Start production server (requires prior build)

# Database Operations
npm run db:push         # Apply database schema changes using Drizzle Kit

# Type Checking
npm run check           # Run TypeScript compiler to check for type errors

# Installation
npm install             # Install all dependencies
```

## Docker Commands

```bash
# Build and run with Docker
docker build . -t shook-app
docker run -p 3000:3000 --env-file .env shook-app

# Using Docker Compose
docker-compose up
```

## Architecture & Project Structure

### Shook Server - Backend API Service

**Tech Stack:**
- Backend: Node.js 22, Express.js, TypeScript (ESM), Drizzle ORM, PostgreSQL (Neon)
- Authentication: Passport.js with local strategy + Kakao OAuth, session-based
- External APIs: YouTube Data API v3, SupaData API, OpenAI API, Expo Push Notifications
- Build: esbuild for production bundling, tsx for development
- Deployment: Docker with multi-stage builds

**Directory Structure:**
```
├── server/              # Express backend API
│   ├── api/             # API route handlers (Express routers)
│   │   ├── auth.ts      # Authentication endpoints
│   │   ├── channels.ts  # YouTube channel management
│   │   ├── videos.ts    # Video data endpoints
│   │   ├── user.ts      # User management
│   │   ├── push-tokens.ts # Mobile push notification tokens
│   │   └── admin.ts     # Administrative endpoints
│   ├── services/        # Business logic layer
│   │   ├── youtube-monitor.ts      # Background YouTube RSS monitoring
│   │   ├── youtube-summary.ts     # AI video summarization
│   │   ├── channel-service.ts     # Channel operations
│   │   ├── push-notification-service.ts # Mobile notifications
│   │   └── error-logging-service.ts     # Centralized logging
│   ├── repositories/    # Data access layer
│   │   └── storage.ts   # Database operations and session store
│   ├── lib/             # Core configurations
│   │   ├── auth.ts      # Passport.js configuration
│   │   └── db.ts        # Database connection setup
│   └── utils/           # Utility functions
├── shared/              # Shared database schema (Drizzle ORM)
│   └── schema.ts        # PostgreSQL tables with Zod validation
├── dist/                # Production build output
├── Dockerfile           # Multi-stage Docker build
├── docker-compose.yml   # Container orchestration
└── package.json         # ESM project configuration
```

**Key Backend Architecture:**
- **Modular API Routes**: Each feature has its own router file in `server/api/`
- **Service Layer**: Business logic separated into services with singleton pattern (`server/services/index.ts`)
- **Repository Pattern**: Data access abstracted in repositories (`server/repositories/storage.ts`)
- **Background Monitoring**: YouTube RSS feed monitoring service runs every 5 minutes
- **Error Logging**: Centralized error logging service with console output and structured logging
- **Session Management**: PostgreSQL-backed sessions with connect-pg-simple
- **Mobile Support**: Push notification service for Expo-based mobile apps

**Critical Architectural Patterns:**
- **YouTube Monitoring Pipeline**: RSS parsing → Content filtering (no Shorts) → Transcript extraction → AI summarization → Push notifications
- **Channel Lifecycle Management**: Auto-cleanup of `youtube_channels` when no users remain subscribed
- **Service Dependencies**: YouTubeMonitor depends on YouTubeSummaryService and PushNotificationService
- **Error Recovery**: Comprehensive error handling for all service failures with detailed logging
- **Multi-Auth Support**: Local username/password and Kakao OAuth authentication

**Database Schema (PostgreSQL with Drizzle ORM):**
- `users` - User accounts with authentication details, roles (user/tester/manager), Kakao OAuth support
- `youtube_channels` - Shared channel metadata with video tracking (recentVideoId, processed, isActive)
- `videos` - Individual video records with summaries, transcripts, and processing status
- `user_channels` - Many-to-many subscription mapping with auto-cleanup logic
- `push_tokens` - Mobile device push notification tokens for Expo
- `session` - PostgreSQL session store for authentication

### Development Environment Configuration

**TypeScript Configuration:**
- ESNext modules with strict mode enabled
- Path aliases: `@shared/*` for shared database schema
- Bundle resolution for esbuild compatibility
- Node.js types and allowImportingTsExtensions enabled

**Build Configuration:**
- **Development**: tsx watch for hot-reloading with `npm run dev`
- **Production**: esbuild bundles server to `dist/server/index.js` in ESM format
- **Docker**: Multi-stage build for optimized container size

**Database Configuration:**
- Drizzle ORM with PostgreSQL dialect and Neon serverless driver
- Schema defined in `shared/schema.ts` with Zod validation schemas
- Push-based migrations (no SQL migration files) - use `npm run db:push`
- Connection pooling through @neondatabase/serverless
- Session store using connect-pg-simple

## External Service Integration

### API Keys Required (Environment Variables)
```
DATABASE_URL=postgresql://...           # Neon PostgreSQL connection
SESSION_SECRET=random_string           # Session encryption
YOUTUBE_API_KEY=google_cloud_key      # YouTube Data API v3
OPENAI_API_KEY=openai_api_key        # OpenAI API for summarization
SUPADATA_API_KEY=supadata_key        # SupaData API for video transcripts
PORT=3000                            # Server port (optional)
NODE_ENV=development                 # Environment setting
```

### API Usage Patterns
- **YouTube Data API**: Channel search, metadata retrieval, RSS feed parsing (10K daily quota)
- **SupaData API**: Video transcript/caption extraction with retry logic (rate limited)
- **OpenAI API**: AI-powered video summarization in Korean using GPT models
- **Kakao OAuth**: User authentication via Kakao accounts
- **Expo Push Notifications**: Mobile app notifications via Expo's service

## Development Guidelines

### Database Management
- **Never write raw SQL migrations** - modify `shared/schema.ts` and run `npm run db:push`
- Schema changes are push-based using Drizzle Kit
- Be cautious of data loss warnings during schema changes

### Error Handling & Monitoring
- Centralized error logging with console output and structured logging
- Use centralized error logging service in `server/services/error-logging-service.ts`
- All service errors include timestamps and detailed context

### Code Patterns
- **API Layer**: Express routers with middleware stack (auth → authorization → business logic)
- **Service Layer**: Singleton pattern with dependency injection, services exported from `server/services/index.ts`
- **Database**: Drizzle ORM with type-safe queries and relations, no raw SQL
- **Authentication**: Session-based auth with Passport.js (local strategy + Kakao OAuth) and PostgreSQL session store
- **Error Handling**: Centralized error logging service with structured logging and timestamps
- **Background Jobs**: YouTube monitoring service runs continuously with interval scheduling
- **Mobile Integration**: Expo push notification service for cross-platform mobile notifications

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
npm run build    # esbuild bundles server to dist/server/index.js
npm run start    # Starts production server
```

**Build Architecture:**
- **Server Build**: esbuild bundles Express app to `dist/server/index.js` (ESM format)
- **Environment**: Production build uses NODE_ENV=production with optimizations
- **Assets**: No static assets - this is a backend-only API server

### Docker Support
- Multi-stage Dockerfile optimized for Node.js 22 Alpine
- `docker-compose.yml` for local development and production deployment
- Production container exposes port 3000
- Environment variables injected via `--env-file .env` or docker-compose

### Background Services & Production Considerations
- **YouTube Monitoring**: Service must run continuously with 5-minute intervals (starts automatically)
- **Database**: Neon serverless with connection pooling (no manual connection management)
- **Session Management**: Persistent PostgreSQL-backed sessions survive server restarts
- **Process Management**: Consider PM2 for production process management and auto-restart
- **Mobile Notifications**: Expo push notification service handles mobile app notifications

## Common Issues & Troubleshooting

1. **API Quota Exceeded**: YouTube API 403 errors - check Google Cloud Console quotas
2. **Database Connection Issues**: Verify DATABASE_URL and Neon database status
3. **Build Failures**: Run `npm run check` for TypeScript errors first
4. **Push Notification Failures**: Check Expo push notification token validity and service status
5. **YouTube Monitoring Stopped**: Check service logs for RSS feed errors or API failures

## Key Configuration Files

- `tsconfig.json` - TypeScript configuration with ESNext modules and path aliases
- `drizzle.config.ts` - Database ORM configuration and schema management
- `package.json` - ESM module configuration with build scripts
- `shared/schema.ts` - Drizzle database schema with Zod validation
- `Dockerfile` - Multi-stage Docker build configuration
- `docker-compose.yml` - Container orchestration for development/production
- `.env` - Environment variables (not committed, use `.env.example` as template)

## YouTube Monitoring Service Architecture

**Core Processing Pipeline:**
1. **RSS Polling**: Fetch XML feeds every 5 minutes for all subscribed channels using `youtube-monitor.ts`
2. **Content Filtering**: Skip YouTube Shorts, process only regular video uploads  
3. **Change Detection**: Compare new video IDs with stored `recentVideoId` in database
4. **Transcript Extraction**: Use SupaData API to get video captions/transcripts
5. **AI Summarization**: Generate Korean summaries using OpenAI API via `youtube-summary.ts`
6. **Mobile Notifications**: Send push notifications to subscribed users via Expo service
7. **State Persistence**: Update database with processing state and results

**Service Architecture:**
- **YouTubeMonitor**: Main orchestrator service that coordinates the monitoring pipeline
- **YouTubeSummaryService**: Handles video transcript fetching and AI summarization
- **PushNotificationService**: Manages mobile push notifications via Expo
- **ChannelService**: Handles channel management and subscription logic
- **ErrorLoggingService**: Centralized logging with structured output and timestamps

**Error Handling Strategy:**
- All service errors automatically logged to console with timestamps
- Graceful degradation when external APIs are unavailable
- Retry logic for transient failures with exponential backoff
- Detailed error context (service, operation, user ID, additional metadata)