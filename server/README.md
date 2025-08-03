# Server Overview

This directory contains the backend services for the Shook application, built with Node.js and Express.js. It is responsible for handling API requests, managing user data, interacting with external APIs (YouTube, Anthropic, Slack), and running background monitoring tasks.

## Directory Structure

-   `server/`
    -   `index.ts`: The main entry point for the Express server. It sets up middleware, initializes Passport.js for authentication, mounts the API router, and starts the YouTube channel monitoring service.
    -   `api/`: Contains Express.js routers for different API domains.
        -   `index.ts`: The central API router that aggregates all other API-specific routers.
        -   `auth.ts`: Handles user authentication routes (login, registration, logout, user session management).
        -   `channels.ts`: Manages user subscriptions to YouTube channels and retrieves channel-related data.
        -   `google.ts`: Implements Google OAuth authentication flow.
        -   `slack.ts`: Manages Slack workspace integration and user-specific Slack channel setup.
        -   `summary.ts`: Provides endpoints for requesting YouTube video summaries.
    -   `services/`: Contains the core business logic and manages singleton instances of various services.
        -   `index.ts`: A "barrel file" that imports all service classes and exports their singleton instances for centralized management and easy access throughout the application.
        -   `channel-service.ts`: Encapsulates logic for managing YouTube channel subscriptions, fetching channel details, and interacting with the database.
        -   `error-logging-service.ts`: Provides a centralized utility for logging errors across the application.
        -   `slack-service.ts`: Handles the business logic for Slack integration, including creating channels, inviting users, and sending messages.
        -   `youtube-monitor.ts`: The background service responsible for periodically checking subscribed YouTube channels for new video uploads and initiating the summarization and notification process.
        -   `youtube-summary.ts`: Contains the core logic for extracting video transcripts and generating AI-powered summaries using the Anthropic Claude API.
    -   `repositories/`: The data access layer, abstracting database interactions.
        -   `storage.ts`: Implements the `IStorage` interface, providing methods for CRUD operations on users, YouTube channels, and user-channel subscriptions using Drizzle ORM.
    -   `lib/`: Contains shared utilities, configurations, and third-party integrations.
        -   `auth.ts`: Configures Passport.js strategies and serialization/deserialization of user sessions.
        -   `db.ts`: Establishes and manages the PostgreSQL database connection using Drizzle ORM.
        -   `slack.ts`: A low-level client for interacting with the Slack Web API.
        -   `vite.ts`: Middleware for serving the client-side Vite application in production environments.
    -   `utils/`: General utility functions used across the server.
        -   `auth-utils.ts`: Helper functions related to authentication, such as checking if a user is authenticated or authorized.
        -   `validation.ts`: Utility functions for validating various data inputs (e.g., email formats, YouTube handles).

## How it Works

The server acts as the central hub for the Shook application. It exposes a RESTful API for the frontend, manages user sessions, and orchestrates background tasks.

1.  **API Requests:** Incoming requests are routed through `server/index.ts` to the appropriate `api/` router, which then delegates to the relevant `services/` for business logic execution.
2.  **Business Logic:** Services in `server/services/` encapsulate the application's core functionalities, interacting with the database via `repositories/storage.ts` and external APIs through dedicated `lib/` clients.
3.  **Background Monitoring:** The `youtube-monitor.ts` service runs periodically to detect new YouTube videos, leveraging `youtube-summary.ts` for AI summarization and `slack-service.ts` for sending notifications.
4.  **Authentication:** Passport.js, configured in `lib/auth.ts`, handles user authentication (local and Google OAuth) and session management.

This structured approach ensures separation of concerns, promotes modularity, and simplifies maintenance and future development.
