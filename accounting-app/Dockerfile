FROM node:18-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
# Build-time NEXT_PUBLIC_* vars must be present at build, not just runtime -
# Next.js inlines them into the client bundle during `next build`.
ARG NEXT_PUBLIC_CBOP_API_URL
ARG NEXT_PUBLIC_CBOP_LOGIN_URL
ARG NEXT_PUBLIC_ACCOUNTING_URL
ENV NEXT_PUBLIC_CBOP_API_URL=$NEXT_PUBLIC_CBOP_API_URL
ENV NEXT_PUBLIC_CBOP_LOGIN_URL=$NEXT_PUBLIC_CBOP_LOGIN_URL
ENV NEXT_PUBLIC_ACCOUNTING_URL=$NEXT_PUBLIC_ACCOUNTING_URL
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
