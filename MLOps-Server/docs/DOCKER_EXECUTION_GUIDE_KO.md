# Intellivix MLOps Docker 실행 가이드

이 문서는 Intellivix MLOps 웹 애플리케이션을 Docker Compose로 실행하는 방법을 설명합니다.

## 1. 구성 파일

```text
intellivix-mlops/
├── Dockerfile
├── compose.yaml
├── .dockerignore
├── config/
│   └── mlops-runtime-config.docker.json
└── docker/
    ├── intellivix-mlops-docker.env.example
    ├── start-intellivix-mlops-docker.sh
    ├── stop-intellivix-mlops-docker.sh
    ├── view-intellivix-mlops-docker-logs.sh
    └── check-intellivix-mlops-docker-status.sh
```

- `Dockerfile`: Node.js 기반 MLOps 애플리케이션 이미지를 생성합니다.
- `compose.yaml`: 포트, 볼륨, 환경 변수, Health Check 및 재시작 정책을 정의합니다.
- `.dockerignore`: 이미지 빌드에 불필요한 파일을 제외합니다.
- `mlops-runtime-config.docker.json`: 컨테이너 내부 경로와 학습 Agent 주소를 정의합니다.
- `intellivix-mlops-docker.env.example`: 호스트 포트와 마운트 경로 설정 예시입니다.
- Docker Shell Script: 시작, 중지, 로그 조회 및 상태 확인 명령을 제공합니다.

## 2. 사전 요구사항

- Docker Engine
- Docker Compose v2
- Linux 환경에서는 현재 사용자가 Docker 명령을 실행할 수 있어야 합니다.

## 3. 기본 실행

프로젝트 폴더에서 다음 명령을 실행합니다.

```bash
./docker/start-intellivix-mlops-docker.sh
```

스크립트는 다음 작업을 수행합니다.

1. Docker와 Docker Compose 사용 가능 여부를 확인합니다.
2. 현재 사용자의 UID와 GID를 컨테이너 실행 사용자에 적용합니다.
3. 작업 폴더를 생성합니다.
4. Docker 이미지를 빌드합니다.
5. 컨테이너를 백그라운드로 실행합니다.

기본 접속 주소는 다음과 같습니다.

```text
http://localhost:18088
```

컨테이너 내부 애플리케이션 포트는 `8080`이며, 호스트의 기본 공개 포트는 `18088`입니다.

## 4. 환경 설정 변경

환경 설정 예시 파일을 프로젝트 루트의 `.env`로 복사합니다.

```bash
cp docker/intellivix-mlops-docker.env.example .env
```

`.env` 예시:

```dotenv
MLOPS_HOST_PORT=18088
MLOPS_UID=1000
MLOPS_GID=1000
MLOPS_WORKSPACE_PATH=./workspace
MLOPS_EXTERNAL_DATA_PATH=./workspace/data
TZ=Asia/Seoul
```

### `MLOPS_HOST_PORT`

브라우저에서 접속할 호스트 포트입니다.

예를 들어 `19088`로 변경하면 다음 주소로 접속합니다.

```text
http://localhost:19088
```

### `MLOPS_WORKSPACE_PATH`

다음 상태와 결과를 영구 보관하는 호스트 폴더입니다.

- 학습 데이터
- 학습 작업 상태
- 학습 로그
- 모델 파일
- ONNX Export 결과

컨테이너 내부에서는 `/app/workspace`로 연결됩니다.

### `MLOPS_EXTERNAL_DATA_PATH`

MLOps 화면에서 추가로 탐색하거나 태깅할 외부 데이터 폴더입니다.

컨테이너 내부에서는 다음 경로로 접근합니다.

```text
/mnt/mlops-data
```

태깅 결과 `.txt` 파일을 저장해야 하므로 이 볼륨은 읽기/쓰기 모드로 연결됩니다.

예시:

```dotenv
MLOPS_EXTERNAL_DATA_PATH=/data/intellivix/training-dataset
```

MLOps 데이터 불러오기 또는 태깅 화면에서 다음 경로를 입력합니다.

```text
/mnt/mlops-data
```

## 5. 컨테이너 상태 확인

```bash
./docker/check-intellivix-mlops-docker-status.sh
```

또는 다음 명령을 사용합니다.

```bash
docker compose ps
```

정상 상태에서는 컨테이너 상태가 `running`이고 Health 상태가 `healthy`로 표시됩니다.

## 6. 로그 확인

```bash
./docker/view-intellivix-mlops-docker-logs.sh
```

또는:

```bash
docker compose logs --follow --tail=200 intellivix-mlops
```

## 7. 중지 및 제거

```bash
./docker/stop-intellivix-mlops-docker.sh
```

이 명령은 컨테이너와 Compose 네트워크를 제거합니다.

`workspace` 및 외부 데이터는 호스트 Bind Mount이므로 컨테이너를 제거해도 유지됩니다.

## 8. 수동 Docker Compose 실행

```bash
docker compose up --detach --build
```

중지:

```bash
docker compose down
```

재시작:

```bash
docker compose restart intellivix-mlops
```

## 9. 실제 학습 서버 Agent 연동

Docker 기본 설정은 `simulator` 모드입니다.

실제 학습 서버 Agent를 사용하려면 `config/mlops-runtime-config.docker.json`에서 다음 값을 변경합니다.

```json
{
  "training": {
    "executionMode": "agent",
    "agentBaseUrl": "http://host.docker.internal:9010"
  },
  "export": {
    "executionMode": "agent",
    "agentBaseUrl": "http://host.docker.internal:9010"
  }
}
```

학습 Agent가 Docker 호스트에서 실행 중이면 `host.docker.internal`을 사용합니다.

Agent가 다른 서버에서 실행 중이면 해당 서버 주소로 변경합니다.

```json
{
  "training": {
    "agentBaseUrl": "http://YOUR_TRAINING_SERVER_IP:9010"
  },
  "export": {
    "agentBaseUrl": "http://YOUR_TRAINING_SERVER_IP:9010"
  }
}
```

설정 변경 후 컨테이너를 재시작합니다.

```bash
docker compose restart intellivix-mlops
```

## 10. GPU 사용 범위

현재 Docker 컨테이너는 대시보드, 파일 관리, 태깅, 상태 관리 및 학습 서버 명령 전달을 담당합니다.

실제 GPU 학습과 ONNX 변환은 외부 학습 서버 Agent에서 수행하는 구조이므로 MLOps 웹 컨테이너 자체에는 GPU Runtime이 필요하지 않습니다.

## 11. 권한 오류 해결

다음과 같은 오류가 발생할 수 있습니다.

```text
EACCES: permission denied
```

현재 사용자의 UID와 GID를 확인합니다.

```bash
id -u
id -g
```

`.env`의 값을 현재 사용자에 맞게 수정합니다.

```dotenv
MLOPS_UID=1001
MLOPS_GID=1001
```

또는 시작 스크립트를 사용하면 현재 UID와 GID가 자동으로 적용됩니다.

외부 데이터 폴더에 현재 사용자의 쓰기 권한이 있는지도 확인해야 합니다.

## 12. 설정 파일 역할

Docker 실행 시 다음 환경 변수가 적용됩니다.

```text
MLOPS_CONFIG_FILE=/app/config/mlops-runtime-config.docker.json
```

`runtime-config-service.js`는 해당 환경 변수를 읽어 Docker 전용 설정 파일을 선택합니다.

일반 Node.js 실행에서는 기존 파일을 사용합니다.

```text
config/mlops-runtime-config.json
```
