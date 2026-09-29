# Contexto de build: la raíz del monorepo  (docker build -f apps/api/Dockerfile .)
# better-sqlite3 trae binarios precompilados para linux x64/arm64: no hace falta compilar.
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --include-workspace-root=false
COPY apps/api apps/api
ENV NODE_ENV=production TRUST_PROXY=true HOST=0.0.0.0 PORT=8787 DB_PATH=/data/andyos.db
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
