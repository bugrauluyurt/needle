FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @needle/web build \
 && pnpm --filter @needle/server deploy --prod --legacy /out

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
ENV NODE_ENV=production PORT=4535 DATA_DIR=/data WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /src/packages/shared ./packages/shared
RUN rm -rf node_modules/@needle/shared && ln -s ../../packages/shared node_modules/@needle/shared \
 && mkdir -p /data && chown node:node /data
COPY --from=build /src/apps/server/src ./src
COPY --from=build /src/apps/web/dist ./web
USER node
EXPOSE 4535
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:4535/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
