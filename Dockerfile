FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV INFIDASH_BACKUP_DIR=/data/backups
ENV PYTHON=/usr/bin/python3
ENV npm_config_python=/usr/bin/python3

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start"]
