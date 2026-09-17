# ---------------------------------------------------------------------------
# TradeKaro — production image
#
# Node 24 is REQUIRED, not a preference: the whole backend is built on the
# built-in `node:sqlite` module, which only became available without a flag in
# Node 23.4/24. Older Node fails at import time.
#
#   docker build -t tradekaro .
#   docker run -d --name tradekaro -p 3000:3000 \
#     --env-file .env.production \
#     -v tradekaro-data:/app/data \
#     tradekaro
#
# The `-v` volume is not optional. Without it every redeploy starts from an
# empty database and every user account disappears.
# ---------------------------------------------------------------------------
FROM node:24-alpine

WORKDIR /app

# NEXT_PUBLIC_* values are inlined at BUILD time, so they must be passed as
# build args — setting them only at runtime has no effect.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Install dependencies first so this layer is cached across source edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production
# Bind on all interfaces: the default binds to localhost, which is unreachable
# from outside the container.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Declared for documentation; compose/`-v` is what actually persists it.
VOLUME ["/app/data"]

# `next start` reads PORT and HOSTNAME from the environment.
CMD ["npm", "run", "start"]
