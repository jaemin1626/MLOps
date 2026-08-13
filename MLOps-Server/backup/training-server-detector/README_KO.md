# Training Server Agent 실행 가이드

학습 서버(`YOUR_TRAINING_SERVER_IP`)에서 MLOps가 보내는 REST 요청을 받아 **conda 환경에서 YOLO 학습**을 실행하는 코드입니다.

## 1. 폴더 배치

MLOps 저장소의 `training-server-agent/` 폴더를 학습 서버에 복사합니다.

```bash
scp -r training-server-agent YOUR_SSH_USER@YOUR_TRAINING_SERVER_IP:/path/to/mlops-train-server/
```

학습 서버에서 기대하는 workspace 구조:

```text
/path/to/mlops-train-server/
├── dataset/
│   └── integrated/          # 이미지 + txt 라벨 + classes.txt
├── detector/
│   ├── weights/             # yolo26l.pt
│   ├── configs/             # data.yaml 저장 위치
│   └── runs/                # 학습 결과
└── training-server-agent/   # 이 코드
    ├── run-agent.sh
    ├── train_detector.py
    └── app/
```

## 2. conda 환경 준비

```bash
conda create -n yolo python=3.10 -y
conda activate yolo
pip install ultralytics flask requests pyyaml
```

## 3. Agent 실행

```bash
cd /path/to/mlops-train-server/training-server-agent
cp .env.example .env
chmod +x run-agent.sh
./run-agent.sh
```

`app/` 폴더 안에서 `python main.py`를 실행하면 import 오류가 납니다.  
아래 중 **하나**로 실행하세요.

```bash
cd /path/to/mlops-train-server/training-server-agent
python start.py
# 또는
python -m app.main
# 또는
./run-agent.sh
```

기본 포트: `9010`

헬스체크:

```bash
curl http://127.0.0.1:9010/api/v1/health
```

## 4. REST API (MLOps 연동)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/health` | 상태 확인 |
| POST | `/api/v1/training/command-preview` | 학습 명령 미리보기 |
| POST | `/api/v1/training/jobs` | 학습 시작 |
| GET | `/api/v1/training/jobs` | 작업 목록 |
| GET | `/api/v1/training/jobs/:jobId` | 작업 상세 |

### 학습 시작 요청 예시

MLOps가 보내는 body:

```json
{
  "jobId": "train_20260807_abc123",
  "executable": "python",
  "args": [
    "train_detector.py",
    "--name", "Detector_YOLO_Training",
    "--dataset", "/path/to/mlops-train-server/dataset/integrated",
    "--output-dir", "/path/to/mlops-train-server/detector/runs",
    "--data-config", "/path/to/mlops-train-server/detector/configs/data.yaml",
    "--model", "/path/to/mlops-train-server/detector/weights/yolo26l.pt",
    "--epochs", "5"
  ],
  "callbackUrl": "http://YOUR_MONITORING_SERVER_IP:18088/api/training/jobs/train_20260807_abc123/callback",
  "parameters": {
    "datasetConfigYaml": "# Ultralytics ...\npath: ...\nnames:\n  0: person\n",
    "datasetConfigAbsolutePath": "/path/to/mlops-train-server/detector/configs/data.yaml"
  }
}
```

Agent 동작 순서:

1. `parameters.datasetConfigYaml`이 있으면 `detector/configs/data.yaml`에 저장
2. `conda run -n yolo python train_detector.py ...` 실행
3. stdout 로그를 파일에 기록
4. `callbackUrl`로 MLOps에 진행률/완료 상태 POST

## 5. MLOps 쪽 설정 변경

`config/mlops-runtime-config.docker.json`:

```json
"training": {
  "executionMode": "remote",
  ...
}
```

컨테이너 재시작:

```bash
docker restart mlops-server
```

## 6. systemd 등록 (선택)

```ini
[Unit]
Description=MLOps Training Server Agent
After=network.target

[Service]
Type=simple
User=YOUR_SSH_USER
WorkingDirectory=/path/to/mlops-train-server/training-server-agent
ExecStart=/path/to/mlops-train-server/training-server-agent/run-agent.sh
Restart=always

[Install]
WantedBy=multi-user.target
```

## 7. 문제 해결

| 증상 | 확인 |
|------|------|
| MLOps에서 로그만 뜨고 학습 서버 무반응 | `executionMode`가 `simulator`인지 확인 |
| Agent 연결 실패 | `curl YOUR_TRAINING_SERVER_IP:9010/api/v1/health` |
| yaml 없음 | MLOps에서 **YAML 구조 확인** 후 학습 실행 |
| conda 오류 | `.env`의 `CONDA_ENV_NAME=yolo` 확인 |

## 8. train_detector.py

Ultralytics YOLO 래퍼입니다. Agent가 `--data-config` yaml과 weights 경로를 받아 `model.train()`을 호출합니다.

직접 테스트:

```bash
conda activate yolo
python train_detector.py \
  --name test_run \
  --dataset /path/to/mlops-train-server/dataset/integrated \
  --output-dir /path/to/mlops-train-server/detector/runs \
  --model /path/to/mlops-train-server/detector/weights/yolo26l.pt \
  --data-config /path/to/mlops-train-server/detector/configs/data.yaml \
  --epochs 1 --batch-size 4 --device 0
```
