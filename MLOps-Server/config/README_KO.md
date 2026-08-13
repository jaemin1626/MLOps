# MLOps 배포 설정

**다른 모니터링 서버로 이전할 때는 `config/mlops-connection.json` 한 파일만 수정**하면 됩니다.

## 빠른 시작

```bash
# 1. 프로젝트 복사 후
cp config/mlops-connection.example.json config/mlops-connection.json

# 2. connection.json 만 환경에 맞게 수정

# 3. Docker 이미지 빌드 및 실행
bash run-intellivix-mlops.sh
```

`run-intellivix-mlops.sh` 가 connection 설정을 읽어 포트, dataset 경로, SSH, agent URL, 컨테이너 내부 경로를 자동 구성합니다.

## 수정할 항목 (`mlops-connection.json`)

| 섹션 | 항목 | 설명 |
|------|------|------|
| `mlopsHost` | `port` | MLOps 웹 포트 (기본 18088) |
| | `publicBaseUrl` | **모니터링 서버 IP/도메인** (학습 agent 콜백용) |
| | `dataRoot` | 로컬 dataset 캐시 (기본 `./cache/ailab2-dataset`) |
| | `workspacePath` | MLOps job/모델 저장 (기본 `./workspace`) |
| | `syncOnStart` | 시작 시 학습 서버 dataset 동기화 |
| `trainingServer` | `host`, `agentPort` | detector agent (기본 9010) |
| | `workspaceRoot` | agent 컨테이너 내부 workspace (보통 `/workspace`) |
| `vlmTrainingServer` | `agentPort` | (선택) VLM agent 포트, 기본 9011 · host는 trainingServer 와 동일 |
| `ssh` | `host`, `user`, `password` | dataset/weights sync, ONNX SSH |
| | `remoteWorkspaceRoot` | 학습 서버 MLops_test 경로 |

### 자동으로 채워지는 값

- `trainingServer.apiBaseUrl` → `http://{host}:{agentPort}`
- `vlmTrainingServer.apiBaseUrl` → `http://{host}:9011`
- `ssh.remoteDatasetPath` → `{remoteWorkspaceRoot}/dataset`
- `mlopsHost.publicBaseUrl` 미입력 시 → `http://127.0.0.1:{port}`

## 예시 (최소 설정)

```json
{
  "mlopsHost": {
    "port": 18088,
    "publicBaseUrl": "http://192.168.1.50:18088",
    "dataRoot": "./cache/ailab2-dataset",
    "workspacePath": "./workspace"
  },
  "trainingServer": {
    "host": "172.16.8.60",
    "agentPort": 9010
  },
  "ssh": {
    "host": "172.16.8.60",
    "user": "ailab2",
    "password": "your-password",
    "remoteWorkspaceRoot": "/home/ailab2/Workspace/MLops_test"
  }
}
```

## 다른 설정 파일

| 파일 | 용도 |
|------|------|
| `mlops-connection.json` | **배포 시 유일하게 수정하는 파일** (gitignore) |
| `mlops-runtime-defaults.json` | 앱 기본 동작 (entry point, scan limit 등) · 수정 불필요 |
| `mlops-runtime-config*.json` | (선택) 고급 override · 일반 배포에서는 사용 안 함 |

## 다른 경로 사용

```bash
export MLOPS_CONNECTION_FILE=/path/to/my-connection.json
bash run-intellivix-mlops.sh
```

## Docker vs 호스트 실행

- Docker: `MLOPS_RUNTIME_PROFILE=docker` (run 스크립트/Dockerfile 에서 자동 설정)
- 호스트 Node 직접 실행: profile `host` · `dataRoot`/`workspacePath` 를 connection 에서 읽음

고급 사용자만 `MLOPS_CONFIG_FILE=config/mlops-runtime-config.json` 으로 scan depth 등을 override 할 수 있습니다.

## 학습 서버 agent

Detector/VLM agent 소스·Docker·동기화 스크립트는 **`backup/`** 폴더에 있습니다. (`backup/README_KO.md`)
