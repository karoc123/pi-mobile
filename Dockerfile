FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/backend/index.js"]