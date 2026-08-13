# Intellivix MLOps (모니터링 서버)

학습 서버와 분리된 **모니터링·오케스트레이션** 웹 애플리케이션입니다.  
dataset 동기화, 학습/Export job 제출, 모델 목록·로그 모니터링을 담당합니다.

## 빠른 실행

```bash
cp config/mlops-connection.example.json config/mlops-connection.json
# connection.json 만 환경에 맞게 수정

bash run-intellivix-mlops.sh
```

접속: `http://localhost:18088` (포트는 `mlops-connection.json` 의 `mlopsHost.port`)

## 배포 설정

**`config/mlops-connection.json`** — 모니터링 서버 호스트·포트, dataset/workspace 경로  
(첫 기동 시 **기본 Connection** 으로 자동 마이그레이션됩니다)

**Connection Registry** — `workspace/connections/registry.json`  
여러 학습 서버를 Connection 단위로 등록합니다. UI **Connection 관리** 메뉴 또는 `GET/POST /api/connections` API 사용.

각 Connection은 고유 `connection_id`·`token`을 가지며, Monitoring Server → Training Agent 요청은 `Authorization: Bearer <token>` 으로 인증합니다.  
Training Agent에는 `GET /api/connections/{id}/config` 로 받은 JSON(`connection.json`) 또는 환경변수 `MLOPS_CONNECTION_ID`, `MLOPS_MONITORING_SERVER`, `MLOPS_CONNECTION_TOKEN` 을 설정하세요.

### 네트워크 권장 구조

허용:

- Monitoring Server → Training Server A/B : 9010 / 9011

차단:

- Training A ↔ Training B

Training Agent 포트(9010/9011)는 Monitoring Server IP에서만 접근하도록 방화벽을 설정하는 것을 권장합니다.

자세한 항목: `config/README_KO.md`

## 포함 기능 (모니터링 서버)

- 대시보드, dataset 브라우저, 태깅 UI
- Detector / VLM 학습 설정·job 모니터링 (SSE 로그)
- 모델 목록, ONNX Export orchestration
- 학습 서버 dataset rsync (SSH)

## 학습 서버 agent (별도 배포)

Detector/VLM GPU 학습 agent 코드·Docker는 **`backup/`** 에 있습니다.

```bash
bash backup/docker/sync-training-agent.sh
```

구성 설명: `backup/README_KO.md`

## Docker / Compose

```bash
./docker/start-intellivix-mlops-docker.sh
# 또는
docker compose up --build
```

상세: `docs/DOCKER_EXECUTION_GUIDE_KO.md`

## 개발·테스트

```bash
node dev/tests/connection-isolation.test.js
npm test   # backup/dev/tests/backend-smoke-test.js 경로는 package.json 참고
```

## 데이터 경로

- `cache/` — 학습 서버 dataset 로컬 미러
- `workspace/` — job, 모델 메타, export 기록

런타임 데이터는 git에 포함하지 않습니다.
