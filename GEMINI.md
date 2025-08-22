# Project Overview: Shook - YouTube Channel Monitoring Service

This is a backend API service designed to monitor YouTube channels and generate AI-powered summaries of new videos.

## Key Features

- **User Registration & Channel Management**: Users can sign up and subscribe to their favorite YouTube channels via their handles
- **Automated Video Monitoring**: A background service runs every 5 minutes to check for new video uploads from the subscribed channels using RSS feeds
- **AI-Powered Summarization**: Upon detecting a new video, the system fetches its transcript and uses the OpenAI API to create a concise summary
- **REST API**: Complete API endpoints for managing users, channels, and video monitoring

## Tech Stack

- **Backend**: Node.js, Express.js, TypeScript (ESM)
- **Database**: PostgreSQL (managed with Neon) and Drizzle ORM
- **Authentication**: Passport.js (local username/password strategy)
- **External APIs**:
  - YouTube Data API v3 (for channel metadata)
  - SupaData API (for video transcripts)
  - OpenAI API (for summarization)

## Project Structure

```
├── server/         # Node.js/Express Backend
│   ├── api/        # API endpoints (using express.Router)
│   │   ├── auth.ts
│   │   ├── channels.ts
│   │   ├── google.ts
│   │   ├── index.ts # Central API router
│   │   └── summary.ts
│   ├── services/   # Business logic and service instances
│   │   ├── channel-service.ts
│   │   ├── error-logging-service.ts
│   │   ├── index.ts # Service instance management (singleton)
│   │   ├── youtube-monitor.ts # Core monitoring logic
│   │   └── youtube-summary.ts # AI-powered summarization
│   ├── repositories/ # Data access layer
│   │   └── storage.ts
│   ├── lib/        # Shared utilities and configurations
│   │   ├── auth.ts # Passport.js setup
│   │   └── db.ts   # Database connection
│   ├── utils/      # General utility functions
│   │   ├── auth-utils.ts
│   │   └── validation.ts
│   └── index.ts    # Server entry point
├── shared/         # Shared Drizzle DB schema
│   └── schema.ts
├── package.json    # Dependencies and scripts
└── drizzle.config.ts # Drizzle ORM configuration
```

## How to Run

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Set up Environment Variables**:
    Create a `.env` file based on the required variables. This includes API keys for YouTube and OpenAI, as well as the database connection string.
3.  **Run the Development Server**:
    ```bash
    npm run dev
    ```
    This command starts both the frontend (Vite) and backend (Express with tsx) servers concurrently.

4.  **Database Migrations**:
    To apply any changes to the database schema (`shared/schema.ts`):
    ```bash
    npm run db:push
    ```
