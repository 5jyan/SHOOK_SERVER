# Shook: YouTube Channel Monitoring Service

Shook is a backend API service that monitors YouTube channels for new videos and generates AI-powered summaries.

## Key Features

- **User Authentication**: Session-based authentication using Passport.js
- **Channel Subscriptions**: Users can subscribe to their favorite YouTube channels by providing the channel handle
- **Automated Video Monitoring**: A background service runs every 5 minutes to check for new video uploads from subscribed channels using their RSS feeds
- **AI-Powered Summarization**: When a new video is detected, the system fetches its transcript and uses the OpenAI API to generate a concise summary
- **REST API**: Complete API endpoints for managing users, channels, and video monitoring

## Tech Stack

- **Backend**: Node.js, Express.js, TypeScript (ESM)
- **Database**: PostgreSQL (managed with Neon) and Drizzle ORM
- **Authentication**: Passport.js with local strategy (username/password)
- **External APIs**:
  - YouTube Data API v3
  - SupaData API (for video transcripts)
  - OpenAI API (for summarization)

## Project Structure

```
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
- API keys for YouTube Data API and OpenAI API

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
    - `DATABASE_URL`: Your PostgreSQL connection string (e.g., from Neon)
    - `SESSION_SECRET`: A long, random string for session encryption
    - `YOUTUBE_API_KEY`: Your YouTube Data API key
    - `OPENAI_API_KEY`: Your OpenAI API key
    - `PORT`: The port for the server to run on (defaults to 3000)
    - `NODE_ENV`: Set to `development` for local development

### Database Migration

Apply the initial database schema using Drizzle ORM:

```bash
npm run db:push
```

### Running the Application

Start the backend server in development mode:

```bash
npm run dev
```

The API server will be available at `http://localhost:3000`.

## Available Scripts

- `npm run dev`: Starts the development server with hot-reloading
- `npm run build`: Builds the server for production
- `npm run start`: Starts the production server (requires a prior build)
- `npm run db:push`: Pushes database schema changes to your PostgreSQL database
- `npm run check`: Runs the TypeScript compiler to check for type errors

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
