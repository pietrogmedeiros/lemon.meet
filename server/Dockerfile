# Stage 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@8

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./

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

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-common \
    chromium-driver \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-freefont-ttf \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@8

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json ./

# Copy server package.json
COPY server/package.json ./server/

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
