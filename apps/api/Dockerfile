# Contexto de build: la raíz del monorepo  (docker build -f apps/api/Dockerfile .)
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --include-workspace-root=false
COPY apps/api apps/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/andyos.db
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
