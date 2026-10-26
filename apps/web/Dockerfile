FROM node:24-alpine AS build

RUN npm install -g pnpm@12.8.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/web/scripts ./apps/web/scripts
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter @nebula/web...

COPY apps/web ./apps/web

ARG PUBLIC_STUN_URL="stun:stun.l.google.com:19302"
ARG PUBLIC_TURN_URL=""
ARG PUBLIC_TURN_USERNAME=""
ARG PUBLIC_TURN_CREDENTIAL=""
ENV PUBLIC_STUN_URL=${PUBLIC_STUN_URL} \
    PUBLIC_TURN_URL=${PUBLIC_TURN_URL} \
    PUBLIC_TURN_USERNAME=${PUBLIC_TURN_USERNAME} \
    PUBLIC_TURN_CREDENTIAL=${PUBLIC_TURN_CREDENTIAL}

RUN pnpm --filter @nebula/web build


FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 4321

CMD ["node", "apps/web/dist/server/entry.mjs"]
