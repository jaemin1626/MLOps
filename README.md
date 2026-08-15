# MLOps Platform

Detector / VLM 학습을 웹 UI에서 관리하는 통합 MLOps 플랫폼입니다.

**데이터 준비 → 태깅 → 학습 → 모니터링 → ONNX Export → 모델 관리**

| 구성 | 역할 | Docker 이미지 |
|------|------|----------------|
| **MLOps-Server** | 모니터링 UI, dataset sync, 학습/Export 요청 | `mlops-server:1.1.1` |
| **MLOps-Train-Server** | Detector / VLM REST agent (학습 실행) | `detector-agent:1.0.0`, `vlm-agent:1.0.0` |

> **deploy 폴더는 필수** — 컨테이너 실행 스크립트가 포함되어 있습니다.
---

## 저장소 구조

```text
MLOps/
├── MLOps-Server/
│   ├── run-mlops.sh
│   ├── Dockerfile
│   └── config/mlops-connection.example.json
│
└── MLOps-Train-Server/
    ├── mlops_train.sh
    ├── training-server-deploy/docker/      # Detector (필수)
    ├── training-server-vlm-deploy/docker/  # VLM (필수)
    ├── training-server-detector/
    ├── training-server-vlm/
    └── dataset/                            # 학습 데이터
```

---

## 1. MLOps-Server

모니터링 UI 서버입니다. Train-Server agent에 REST로 학습 명령을 보냅니다.

### 설정

```bash
cd MLOps-Server
cp config/mlops-connection.example.json config/mlops-connection.json
```

`mlops-connection.json`에서 `YOUR_*` 값을 입력합니다.

| 항목 | 설명 |
|------|------|
| `mlopsHost.publicBaseUrl` | MLOps UI 주소 (학습 콜백용) |
| `trainingServer.host` | Train-Server IP |
| `ssh.host / user / password` | dataset sync, SSH |
| `ssh.remoteWorkspaceRoot` | Train-Server 경로 (예: `/path/to/mlops-train-server`) |

### 빌드 + 실행 (tar 없이)

```bash
cd MLOps-Server
bash run-mlops.sh
```

이미지가 없으면 `docker build -t mlops-server:1.1.1 .` 를 자동 실행합니다.

### 빌드만

```bash
docker build -t mlops-server:1.1.1 .
```

### Compose

```bash
docker compose up --build -d
```

### 확인

- UI: `http://localhost:18088`
- Health: `http://localhost:18088/api/health`

---

## 2. MLOps-Train-Server

Detector / VLM 학습 agent입니다. MLOps-Server에서 보낸 REST 명령을 실행합니다.

### GPU 설정

```bash
cd MLOps-Train-Server

cp training-server-deploy/docker/.env.example training-server-deploy/docker/.env
cp training-server-vlm-deploy/docker/.env.example training-server-vlm-deploy/docker/.env
```

| 파일 | 예시 |
|------|------|
| `training-server-deploy/docker/.env` | `DETECTOR_GPU_DEVICE=0` |
| `training-server-vlm-deploy/docker/.env` | `VLM_GPU_DEVICE=0` 또는 `0,1` |

GPU 확인: `nvidia-smi -L`

### 빌드 + 실행 (tar 없이)

```bash
cd MLOps-Train-Server
bash mlops_train.sh
```

### 빌드만

```bash
bash training-server-deploy/docker/build-image.sh      # detector-agent:1.0.0
bash training-server-vlm-deploy/docker/build-image.sh  # vlm-agent:1.0.0
```

### 실행만 (이미 빌드됨)

```bash
bash mlops_train.sh --no-build
```

### 확인

| Agent | Health |
|-------|--------|
| Detector | `http://127.0.0.1:9010/api/v1/health` |
| VLM | `http://127.0.0.1:9011/api/v1/health` |

---

## 3. (선택) tar로 이미지 로드

빌드 시간을 줄이려면 미리 export한 tar를 사용합니다.

```bash
docker load -i detector-agent-1.0.0.tar
docker load -i vlm-agent-1.0.0.tar
docker load -i mlops-server-1.1.1.tar
```

로드 후:

```bash
cd MLOps-Train-Server && bash mlops_train.sh --no-build
cd MLOps-Server && bash run-mlops.sh
```

---

## 4. 이미지 export

```bash
docker save -o mlops-server-1.1.1.tar mlops-server:1.1.1
docker save -o detector-agent-1.0.0.tar detector-agent:1.0.0
docker save -o vlm-agent-1.0.0.tar vlm-agent:1.0.0
```

---

## 5. dataset 구조

```text
dataset/
├── detector/
│   ├── Images/
│   └── ...
└── vlm/
    ├── Images/
    └── json/
```

---

## 6. 전체 실행 순서

```bash
# 1) Train-Server
cd MLOps-Train-Server
cp training-server-deploy/docker/.env.example training-server-deploy/docker/.env
cp training-server-vlm-deploy/docker/.env.example training-server-vlm-deploy/docker/.env
bash mlops_train.sh

# 2) MLOps-Server
cd ../MLOps-Server
cp config/mlops-connection.example.json config/mlops-connection.json
# mlops-connection.json 수정
bash run-mlops.sh
```

---

## 주요 기능

Connection · Dashboard · Data Tagging (Detector/VLM) · Training · Monitoring · ONNX Export · Model Management

---

**MLOps Platform** · Version `1.1.1`
