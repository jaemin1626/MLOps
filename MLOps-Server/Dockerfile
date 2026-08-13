# MLOps Platform web application container image.
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="MLOps Platform" \
      org.opencontainers.image.description="File-based MLOps Platform web application" \
      org.opencontainers.image.version="1.1.1"

ENV NODE_ENV=production \
    TZ=Asia/Seoul \
    PORT=8080 \
    MLOPS_RUNTIME_PROFILE=docker

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client sshpass util-linux \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node config ./config
COPY --chown=node:node public ./public
COPY --chown=node:node server ./server
COPY --chown=node:node workspace ./workspace
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x ./docker/entrypoint.sh \
    && mkdir -p \
      /app/workspace/data \
      /app/workspace/jobs/running \
      /app/workspace/jobs/completed \
      /app/workspace/jobs/failed \
      /app/workspace/models \
      /app/workspace/exports \
      /app/workspace/logs \
      /workspace/dataset \
    && chown -R node:node /app /workspace

USER root

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "const port=process.env.PORT||8080; fetch('http://127.0.0.1:'+port+'/api/health').then((response)=>{ if(!response.ok) process.exit(1); }).catch(()=>process.exit(1));"

ENTRYPOINT ["/app/docker/entrypoint.sh"]