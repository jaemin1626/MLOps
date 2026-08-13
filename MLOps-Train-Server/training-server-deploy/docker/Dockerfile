FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

LABEL org.opencontainers.image.title="MLOps Detector Training Server Agent" \
      org.opencontainers.image.description="REST API agent for YOLO detector training on mlops-train-server workspace"

WORKDIR /app

ARG DOCKER_SUBPATH=docker
ARG AGENT_SUBPATH=training-server-detector

ENV PYTHONUNBUFFERED=1 \
    TZ=Asia/Seoul \
    USE_CONDA=0 \
    WORKSPACE_ROOT=/workspace \
    AGENT_HOST=0.0.0.0 \
    AGENT_PORT=9010 \
    OPENCV_IO_ENABLE_OPENEXR=1 \
    QT_QPA_PLATFORM=offscreen

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcb-render0 \
    libxcb-shm0 \
    libxcb-xinerama0 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY ${DOCKER_SUBPATH}/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && pip uninstall -y opencv-python opencv-contrib-python 2>/dev/null || true \
    && pip install --no-cache-dir --force-reinstall "opencv-python-headless>=4.8.0" \
    && rm -f /tmp/requirements.txt \
    && python -c "import importlib.metadata as m; pkgs={d.metadata['Name'] for d in m.distributions()}; assert 'opencv-python-headless' in pkgs; import cv2; from ultralytics import YOLO; print('opencv/ultralytics ok')"

COPY ${AGENT_SUBPATH}/app ./app
COPY ${AGENT_SUBPATH}/train_detector.py ./train_detector.py
COPY ${AGENT_SUBPATH}/export_onnx.py ./export_onnx.py
COPY ${AGENT_SUBPATH}/pseudo_label.py ./pseudo_label.py
COPY ${AGENT_SUBPATH}/start.py ./start.py

EXPOSE 9010

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9010/api/v1/health')"

CMD ["python", "-m", "app.main"]
