# Shook: YouTube Channel Monitoring & Slack Notifier

Shook is a full-stack application that monitors YouTube channels for new videos, generates AI-powered summaries, and delivers them as notifications to a user's Slack workspace.

## Key Features

- **User Authentication**: Secure user sign-up and login using Google OAuth.
- **Channel Subscriptions**: Users can subscribe to their favorite YouTube channels by providing the channel handle.
- **Automated Video Monitoring**: A background service runs every 5 minutes to check for new video uploads from subscribed channels using their RSS feeds.
- **AI-Powered Summarization**: When a new video is detected, the system fetches its transcript and uses the Anthropic Claude API to generate a concise summary.
- **Slack Integration**: The generated summary, along with the video title and a link, is sent to a dedicated, private Slack channel for the user.
- **Web Interface**: A React-based frontend provides a user-friendly interface for managing channel subscriptions.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Shadcn/ui, TanStack Query
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL (managed with Neon) and Drizzle ORM
- **Authentication**: Passport.js with Google OAuth 2.0
- **External APIs**:
  - YouTube Data API v3
  - SupaData API (for video transcripts)
  - Anthropic Claude API (for summarization)
  - Slack Web API

## Project Structure

```
├── client/         # React Frontend
├── server/         # Node.js/Express Backend
├── shared/         # Shared Drizzle DB schema
├── .env.example    # Example environment variables
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v18 or later)
- npm
- Docker (optional, for containerized deployment)
- A registered application on Google Cloud Platform to get OAuth 2.0 credentials.
- A Slack App with a Bot Token.
- API keys for YouTube Data API and Anthropic Claude API.

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd shook
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Environment Setup

1.  Create a `.env` file by copying the example file:
    ```bash
    cp .env.example .env
    ```
2.  Open the `.env` file and fill in the required environment variables:
    - `DATABASE_URL`: Your PostgreSQL connection string (e.g., from Neon).
    - `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
    - `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret.
    - `SESSION_SECRET`: A long, random string for session encryption.
    - `SLACK_BOT_TOKEN`: Your Slack bot user OAuth token.
    - `SLACK_SIGNING_SECRET`: Your Slack app's signing secret.
    - `YOUTUBE_API_KEY`: Your YouTube Data API key.
    - `ANTHROPIC_API_KEY`: Your Anthropic Claude API key.
    - `PORT`: The port for the server to run on (defaults to 3000).
    - `NODE_ENV`: Set to `development` for local development.

### Database Migration

Apply the initial database schema using Drizzle ORM:

```bash
npm run db:push
```

### Running the Application

Start both the frontend and backend servers in development mode:

```bash
npm run dev
```

The application will be available at `http://localhost:5173` (Vite's default port for the client).

## Available Scripts

- `npm run dev`: Starts the development server for both client and server with hot-reloading.
- `npm run build`: Builds the client and server for production.
- `npm run start`: Starts the production server (requires a prior build).
- `npm run db:push`: Pushes database schema changes to your PostgreSQL database.
- `npm run check`: Runs the TypeScript compiler to check for type errors.

## Docker Deployment

This project includes a `Dockerfile` and `docker-compose.yml` for containerized deployment.

1.  **Build the Docker image:**
    ```bash
    docker build . -t shook-app
    ```
2.  **Run the container:**
    ```bash
    docker run -p 3000:3000 --env-file .env shook-app
    ```

This will start the application in a Docker container, accessible at `http://localhost:3000`.
