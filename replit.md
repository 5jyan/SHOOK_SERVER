# YouTube Channel Summary & Slack Notification Service

## Overview

This is a full-stack web application that monitors YouTube channels for new video uploads, automatically generates summaries of video content, and sends notifications to users via Slack. The system combines React frontend with Express backend, using PostgreSQL for data persistence and integrating with YouTube Data API and Slack API.

## User Preferences

Preferred communication style: Simple, everyday language.
Font family: Titillium Web for consistent typography throughout the application.
Design style: Gmail-inspired clean interface with purple accent colors and unified color scheme.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for development and bundling
- **UI Framework**: Shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for client-side routing
- **Forms**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Authentication**: Passport.js with local strategy and express-session
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Session Storage**: PostgreSQL-backed sessions using connect-pg-simple
- **API Integration**: YouTube Data API v3 and Slack Web API

### Data Storage Solutions
- **Primary Database**: PostgreSQL (configured for Neon serverless)
- **ORM**: Drizzle ORM with schema-first approach
- **Session Store**: PostgreSQL table for session persistence
- **Migration Tool**: Drizzle Kit for schema migrations

## Key Components

### Authentication System
- **Strategy**: Username/password authentication with scrypt hashing
- **Session Management**: Server-side sessions with PostgreSQL storage
- **Security**: CSRF protection via session secrets and timing-safe password comparison
- **Authorization**: Protected routes using authentication middleware

### YouTube Integration
- **Channel Management**: Users can add YouTube channels by handle (@channelname)
- **Data Fetching**: YouTube Data API v3 for channel info, video listings, and captions
- **Content Processing**: Automatic subtitle extraction and video summarization
- **Monitoring**: Periodic RSS feed checking for new uploads

### Slack Integration
- **Bot Integration**: Slack Web API with bot tokens
- **User Management**: Email-based Slack workspace invitations
- **Channel Creation**: Dynamic private channel creation for each user
- **Notification Delivery**: Automated summary posting to user channels

### User Interface
- **Design System**: Consistent component library with dark/light theme support
- **Responsive Design**: Mobile-first approach with responsive breakpoints
- **Form Handling**: Validated forms with real-time error feedback
- **State Feedback**: Loading states, error handling, and success notifications

## Data Flow

1. **User Registration**: Users create accounts and authenticate via username/password
2. **Channel Addition**: Users input YouTube channel handles, system validates via API
3. **Slack Setup**: Users provide email for Slack workspace invitation
4. **Monitoring Loop**: System periodically checks RSS feeds for new videos
5. **Content Processing**: New videos trigger subtitle extraction and summarization
6. **Notification**: Summaries are posted to user's private Slack channels

## External Dependencies

### Required APIs
- **YouTube Data API v3**: Channel information, video metadata, captions
- **Slack Web API**: User management, channel creation, message posting
- **Google OAuth**: For YouTube API authentication (captions access)

### Third-Party Services
- **Neon Database**: Serverless PostgreSQL hosting
- **Slack Workspace**: Target workspace for notifications (newsfeed-fcm6025.slack.com)

### Key Libraries
- **@neondatabase/serverless**: WebSocket-enabled PostgreSQL client
- **@slack/web-api**: Official Slack SDK
- **passport**: Authentication middleware
- **drizzle-orm**: Type-safe database operations
- **@tanstack/react-query**: Server state management
- **@radix-ui/***: Accessible UI primitives

## Deployment Strategy

### Build Process
- **Client**: Vite builds React app to `dist/public`
- **Server**: esbuild bundles Express server to `dist/index.js`
- **Assets**: Static files served from built distribution

### Environment Configuration
- **Development**: tsx for TypeScript execution, Vite dev server
- **Production**: Node.js serves bundled application
- **Database**: PostgreSQL connection via DATABASE_URL environment variable
- **Security**: SESSION_SECRET for session encryption

### API Requirements
- Google Cloud Console project with YouTube Data API v3 enabled
- Slack App with appropriate bot permissions and tokens
- PostgreSQL database with appropriate connection credentials

### Monitoring & Automation
- 5-minute interval RSS feed checking with streamlined video detection
- RSS-based new video detection (compares latest video ID with stored recent_video_id)
- Consolidated video tracking in youtube_channels table (removed monitored_videos table)
- Automatic transcript extraction, AI summarization, and Slack delivery
- Real-time UI updates via React Query
- Enhanced channel deletion: removes from user_channels and cleans up orphaned youtube_channels records