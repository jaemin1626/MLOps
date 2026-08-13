# Training Server Docker 배포 가이드

학습 서버에 아래 구조로 두고 **sh 파일만 실행**하면 됩니다.

```text
Intellivix_MLops_train_server/
├── dataset/
├── detector/
├── training-server-agent/     # REST API 코드
└── docker/                    # 이 폴더 내용
    ├── Dockerfile
    ├── requirements.txt
    ├── .env.example
    ├── build-image.sh
    ├── run-docker.sh
    ├── stop-docker.sh
    ├── restart-docker.sh
    ├── status-docker.sh
    ├── install-all.sh
    ├── save-image.sh
    └── load-image.sh
```

Intellivix MLOps 저장소에서는 `training-server-deploy/docker/` 내용을  
학습 서버의 `Intellivix_MLops_train_server/docker/` 로 복사해서 사용합니다.

---

## 1. 처음 설치 (학습 서버)

```bash
cd ~/Workspace/Intellivix_MLops_train_server/docker
cp .env.example .env
chmod +x *.sh
./install-all.sh
```

또는 단계별:

```bash
./build-image.sh
./run-docker.sh
./status-docker.sh
```

---

## 2. 자주 쓰는 명령

| 명령 | 설명 |
|------|------|
| `./build-image.sh` | Docker 이미지 빌드 |
| `./run-docker.sh` | 컨테이너 실행 + **실시간 로그 follow (기본)** |
| `./run-docker.sh --no-follow` | 컨테이너만 실행 (로그 follow 없음) |
| `./run-docker.sh --foreground` | 포그라운드 실행 (터미널에 REST 로그 직접 출력) |
| `./stop-docker.sh` | 컨테이너 중지 |
| `./restart-docker.sh` | 재시작 + **실시간 로그 follow (기본)** |
| `./logs-docker.sh` | 실행 중 컨테이너 로그만 follow |
| `./status-docker.sh` | 상태 + health check + 최근 로그 30줄 |
| `docker logs -f intellivix-detector-agent` | 위 `logs-docker.sh` 와 동일 |

---

## 3. 다른 서버로 옮기기

### A. 이미지 tar로 옮기기 (인터넷 없는 서버)

**보내는 서버**

```bash
cd ~/Workspace/Intellivix_MLops_train_server/docker
./build-image.sh
./save-image.sh
# 생성: intellivix-detector-agent.tar.gz
```

**받는 서버**

```bash
# Intellivix_MLops_train_server/training-server-agent + Intellivix_MLops_train_server/docker + tar 파일 복사
cd ~/Workspace/Intellivix_MLops_train_server/docker
./load-image.sh intellivix-detector-agent.tar.gz
cp .env.example .env
./run-docker.sh
```

### B. 소스에서 다시 빌드

```bash
# training-server-agent + docker 폴더만 복사
cd ~/Workspace/Intellivix_MLops_train_server/docker
cp .env.example .env
./install-all.sh
```

---

## 4. .env 설정

```bash
DETECTOR_IMAGE=intellivix-detector-agent:1.0.0
DETECTOR_CONTAINER=intellivix-detector-agent
AGENT_PORT=9010
DETECTOR_GPU_DEVICE=0          # GPU 없으면 빈 값
DETECTOR_NETWORK_MODE=host
AUTH_TOKEN=                 # 필요 시 설정
```

---

## 5. MLOps 연동

MLOps 서버 설정:

```json
"training": { "executionMode": "remote" },
"trainingServer": { "baseUrl": "http://172.16.8.60:9010" }
```

```bash
docker restart intellivix-mlops
```

---

## 6. ONNX Export / GPU

`export_onnx.py` **v2** 부터 `--img-size 512,896` 형식과 `--max-det`, `--conf-thres`, `--iou-thres` 를 지원합니다.

**v3** 부터 E-NMS(`--end2end`), Dynamic Batch(`--dynamic-batch`), Simplify(`--simplify`) 플래그를 CLI에서 받습니다.

**v4** 부터 pre-NMS raw ONNX export + `EfficientNMS_TRT` GraphSurgeon 삽입 방식으로 E-NMS ONNX를 생성합니다. (`onnx`, `onnx-graphsurgeon` 필요)

MLOps에서 ONNX Export 실패(`invalid int value: '512,896'`)가 나면 **학습 서버 agent Docker 이미지를 재빌드**하세요.

**MLOps 호스트에서 agent 코드 동기화 + 원격 재빌드**

```bash
cd ~/intellivix-mlops
MLOPS_AGENT_REBUILD=1 bash docker/sync-training-agent.sh
```

**학습 서버에서 직접**

```bash
cd ~/Workspace/Intellivix_MLops_train_server/docker
./build-image.sh
./restart-docker.sh
```

재배포 후 health 확인:

```bash
curl -s http://172.16.8.60:9010/api/v1/health | grep exportOnnxVersion
# "exportOnnxVersion":"4" 이어야 합니다.
```

Export 실행 시 GPU가 없으면 `export_onnx.py`가 **자동으로 CPU export**로 전환합니다.

GPU 학습/Export를 쓰려면:

```bash
# .env
DETECTOR_GPU_DEVICE=0

# nvidia-container-toolkit 설치 후
bash restart-docker.sh
docker exec intellivix-detector-agent python -c "import torch; print(torch.cuda.is_available())"
```

`False`이면 host Docker GPU 설정을 확인하세요.

---

## 7. 주의

- `docker build`는 **`Intellivix_MLops_train_server` 루트를 context**로 사용합니다. (`build-image.sh`가 처리)
- workspace 데이터는 **volume mount** (`Intellivix_MLops_train_server` → `/workspace`) 로 유지됩니다.
- Docker 컨테이너 안에서는 conda를 쓰지 않습니다 (`USE_CONDA=0`).
