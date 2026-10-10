FROM node:22-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build && npm prune --omit=dev

FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker/entrypoint.sh ./docker/entrypoint.sh

ENV HOME=/home/node
ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
CMD ["node", "dist/backend/index.js"]
