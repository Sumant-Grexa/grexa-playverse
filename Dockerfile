FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @playverse/web build

ENV NODE_ENV=production
ENV UPLOAD_DIR=/data/uploads
EXPOSE 3000

CMD ["sh", "docker/start.sh"]
