FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

LABEL org.opencontainers.image.title="Intellivix VLM Training Server Agent" \
      org.opencontainers.image.description="REST API agent for Qwen VL fine-tuning on Intellivix workspace"

WORKDIR /app

ARG DOCKER_SUBPATH=training-server-vlm-deploy/docker
ARG AGENT_SUBPATH=training-server-vlm

ENV PYTHONUNBUFFERED=1 \
    TZ=Asia/Seoul \
    USE_CONDA=0 \
    WORKSPACE_ROOT=/workspace \
    AGENT_HOST=0.0.0.0 \
    AGENT_PORT=9011

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY ${DOCKER_SUBPATH}/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt \
    && python -c "import torch, transformers, peft; print('torch', torch.__version__, 'transformers/peft ok')"

COPY ${AGENT_SUBPATH}/app ./app
COPY ${AGENT_SUBPATH}/train_vlm.py ./train_vlm.py
COPY ${AGENT_SUBPATH}/start.py ./start.py

EXPOSE 9011

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9011/api/v1/health')"

CMD ["python", "-m", "app.main"]
