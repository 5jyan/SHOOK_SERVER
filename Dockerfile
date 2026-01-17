# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Stage 2: Build the application
FROM deps AS builder
WORKDIR /app
COPY . .
# Build the server
RUN npm run build

# Stage 3: Production image
FROM node:22-alpine AS production
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install Python for youtube-transcript-api execution
RUN apk add --no-cache python3 py3-pip \
  && pip3 install --no-cache-dir youtube-transcript-api

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built server from 'builder' stage
# Build script outputs to 'dist/server'
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared

# Copy public folder for static files (privacy policy, terms of service)
COPY --from=builder /app/public ./public

# Expose the port the server will run on
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/server/index.js"]
