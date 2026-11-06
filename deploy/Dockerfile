# The static site (scripts/dist.mjs) served by scripts/serve.mjs: COOP and
# COEP, brotli, caching. Built from the repository's root, with dist/:
#   docker build -f deploy/Dockerfile -t rocq-web .
FROM node:24-alpine
COPY scripts/serve.mjs /serve.mjs
COPY dist /site
EXPOSE 8080
USER node
CMD ["node", "/serve.mjs", "/site", "8080"]
