FROM golang:1.22-alpine AS agent-builder
WORKDIR /src
COPY agent/go.mod agent/main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o supervision-agent .

FROM node:22-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN npm ci
COPY backend/ .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=agent-builder /src/supervision-agent ./agent-bin/supervision-agent
RUN chmod +x ./agent-bin/supervision-agent
USER nestjs
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
