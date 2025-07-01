# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/oursaas-core/package.json ./packages/oursaas-core/
RUN npm ci --no-audit --no-fund

FROM deps AS test
WORKDIR /app
ENV CI=true
COPY . .
RUN npm test

FROM deps AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 oursaas
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/shared ./shared
USER oursaas
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(0))"
CMD ["node", "dist/index.js"]
