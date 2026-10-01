FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/data/amecc.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY worker ./worker
COPY migrations ./migrations
COPY server ./server
EXPOSE 8787
CMD ["node", "server/index.js"]
