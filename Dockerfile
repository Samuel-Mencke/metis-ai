FROM node:22-bookworm

WORKDIR /app
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
ENV METIS_DOCKER=1
ENV AGENT_CWD=/workspace
ENV CHAT_DATA_DIR=/data
ENV AI_CHAT_ROOT=/app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm exec playwright install --with-deps chromium

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3100 8787
ENTRYPOINT ["/entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "server.mjs"]
