# Project Overview: Shook - YouTube Channel Monitoring & Slack Notifier

This is a full-stack application designed to monitor YouTube channels, generate AI-powered summaries of new videos, and deliver them as notifications to a user's Slack workspace.

## Key Features

- **User Registration & Channel Management**: Users can sign up and subscribe to their favorite YouTube channels via their handles.
- **Automated Video Monitoring**: A background service runs every 5 minutes to check for new video uploads from the subscribed channels using RSS feeds.
- **AI-Powered Summarization**: Upon detecting a new video, the system fetches its transcript and uses the Anthropic Claude API to create a concise summary.
- **Slack Integration**: The generated summary, along with the video title and thumbnail, is sent to a dedicated, private Slack channel for the user.
- **Web Interface**: A React-based frontend provides a user-friendly interface for managing channel subscriptions.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Shadcn/ui, TanStack Query
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL (managed with Neon) and Drizzle ORM
- **Authentication**: Passport.js (local username/password strategy)
- **External APIs**:
  - YouTube Data API v3 (for channel metadata)
  - SupaData API (for video transcripts)
  - Anthropic Claude API (for summarization)
  - Slack Web API (for notifications)

## Project Structure

```
├── client/         # React Frontend
│   ├── src/
│   └── index.html
├── server/         # Node.js/Express Backend
│   ├── routes/     # API endpoints
│   ├── services/   # Business logic
│   ├── index.ts    # Server entry point
│   └── youtube-monitor.ts # Core monitoring logic
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
    Create a `.env` file based on the required variables listed in `PROJECT_HANDOVER.md`. This includes API keys for YouTube, Anthropic, and Slack, as well as the database connection string.
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
