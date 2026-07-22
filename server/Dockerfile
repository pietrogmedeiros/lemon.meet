# Stage 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* tsconfig.json ./

# Copy package.json files
COPY server/package.json ./server/
COPY web/package.json ./web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY server ./server
COPY web ./web

# Build backend
RUN pnpm --filter @vibe-ai/server build

# Stage 2: Production
FROM node:20-bookworm-slim

# ffmpeg — transcode de áudio p/ fallback Whisper (meetingbaas.routes.ts)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./

# Copy server package.json
COPY server/package.json ./server/
COPY web/package.json ./web/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --filter @vibe-ai/server

# Copy built server code from builder stage
COPY --from=builder /app/server/dist ./server/dist

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /app /home/appuser

# Switch to non-root user
USER appuser

WORKDIR /app/server

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "dist/server.js"]
