# syntax=docker/dockerfile:1
#
# IMPORTANT — build context is the PARENT directory, not this repo.
# The composition root (app.js) requires `digital-technologies-core` as a local
# path dependency (../digital-technologies-core) and the two repos are siblings on
# disk. The image therefore has to see both. Build from the parent directory:
#
#   cd ..                      # parent of digital-technologies-knowledge
#   docker build \
#     -f digital-technologies-knowledge/Dockerfile \
#     -t digital-technologies-knowledge:2.0 .
#
# (Optionally add nooblyjs-app-wiki-workflows/ to the context too if
#  the deployment runs the sibling workflow steps.)

# ---------------------------------------------------------------------------
# Stage 1 — build: install production dependencies for BOTH the composition
# root (web-server stack: express/helmet/cors/socket.io/…) and the backend
# module (its own deps), plus the core service registry.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /usr/src

# The core service registry is a local path dependency of the root package.json
# (digital-technologies-core: "../digital-technologies-core/"). Copy it first so
# the root `npm ci` can resolve it, and so it gets its own production deps.
COPY digital-technologies-core/ ./digital-technologies-core/
RUN cd digital-technologies-core \
    && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

WORKDIR /usr/src/app

# Root (composition root) dependencies — installed first for layer caching.
COPY digital-technologies-knowledge/package*.json ./
# The core path dependency must exist at the location package.json points to
# (../digital-technologies-core) relative to this WORKDIR.
RUN npm ci --omit=dev

# Backend module dependencies.
COPY digital-technologies-knowledge/backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Application source.
COPY digital-technologies-knowledge/app.js ./app.js
COPY digital-technologies-knowledge/backend/ ./backend/
COPY digital-technologies-knowledge/applications/ ./applications/
COPY digital-technologies-knowledge/public/ ./public/
COPY digital-technologies-knowledge/.docs/ ./.docs/

# ---------------------------------------------------------------------------
# Stage 2 — runtime: non-root, minimal.
# ---------------------------------------------------------------------------
FROM node:20-alpine

# Security: run as a non-root user.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /usr/src

# Bring the core sibling across so the ../digital-technologies-core path resolves
# at runtime exactly as it did at build time.
COPY --from=builder --chown=appuser:appgroup /usr/src/digital-technologies-core ./digital-technologies-core

WORKDIR /usr/src/app
COPY --from=builder --chown=appuser:appgroup /usr/src/app .

# Application data directory, owned by the runtime user.
RUN mkdir -p .application && chown -R appuser:appgroup .application

USER appuser

EXPOSE 9101

# Health check hits the composition root's own endpoint (app.js registers
# GET /api/health via backend/app.js). start-period is generous because the
# critical-path startup (backend:initialize) runs before listen().
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9101/api/health || exit 1

# Launch the COMPOSITION ROOT, not backend/app.js (which binds no server and only
# exports { initialize }). This matches `npm start` == `node app.js`.
CMD ["node", "app.js"]
