# Pinned by digest so the base image can't change under us. Dependabot proposes updates.
FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY CHANGELOG.md ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production FOLIO_DB=/data/folio.db FOLIO_UPLOAD_DIR=/data/uploads PORT=3000
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
