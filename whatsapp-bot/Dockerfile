# Multi-stage Docker build for Oddsbanta WhatsApp Bot
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create auth_info volume mount directory
RUN mkdir -p /app/auth_info

EXPOSE 8080

CMD ["node", "dist/index.js"]
