FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
COPY bridges bridges
RUN pnpm --filter @needle/web build \
 && pnpm --filter @needle/server deploy --prod --legacy /out

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production PORT=4535 DATA_DIR=/data WEB_DIST=/app/web YTMUSIC_PYTHON=/opt/ytmusic/bin/python YTMUSIC_BRIDGE_PATH=/app/bridges/youtube-music/src/youtube_music_bridge.py UV_PROJECT_ENVIRONMENT=/opt/ytmusic
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv@sha256:2381d6aa60c326b71fd40023f921a0a3b8f91b14d5db6b90402e65a635053709 /uv /uvx /bin/
COPY --from=build /src/bridges/youtube-music /app/bridges/youtube-music
RUN apk add --no-cache python3 \
 && uv sync --project /app/bridges/youtube-music --locked --no-dev --no-editable --python /usr/bin/python3 \
 && rm -rf /root/.cache/uv
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /src/packages/shared ./packages/shared
RUN rm -rf node_modules/@needle/shared && ln -s ../../packages/shared node_modules/@needle/shared \
 && mkdir -p /data && chown node:node /data && chmod 0700 /data
COPY --from=build /src/apps/server/src ./src
COPY --from=build /src/apps/web/dist ./web
USER node
EXPOSE 4535
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:4535/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
