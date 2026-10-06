# Contexto de build: raíz del repo (Easypanel). Dockerfile: mcp/Dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev
COPY mcp/server.js mcp/tools.js ./
USER node
EXPOSE 3000 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1
CMD ["node", "server.js"]
