# Multi-stage build for the API and worker (same image, different command).
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
RUN npm ci --workspace=@duenudge/shared --workspace=@duenudge/api --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend
RUN npm run build -w @duenudge/shared && npm run build -w @duenudge/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /repo/node_modules node_modules
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/backend/package.json backend/package.json
COPY --from=build /repo/backend/dist backend/dist
COPY --from=build /repo/backend/src/db/migrations backend/src/db/migrations
WORKDIR /repo/backend
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/server.js"]
