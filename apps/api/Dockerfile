FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.16.0 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter api... --frozen-lockfile

FROM node:22-alpine AS build
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.16.0 --activate
WORKDIR /repo
COPY --from=deps /repo /repo
COPY apps/api apps/api
WORKDIR /repo/apps/api
RUN pnpm prisma generate && pnpm build

FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@10.16.0 --activate
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
ENV NODE_ENV=production
ENV API_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "pnpm prisma:deploy && node dist/main.js"]
