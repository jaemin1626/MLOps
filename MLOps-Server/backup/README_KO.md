# backup — 모니터링 서버 배포에서 제외된 구성

모니터링 서버(`run-intellivix-mlops.sh`)만 운영할 때는 루트의 MLOps 스택만 필요합니다.  
학습 서버 전용 코드·이미지·개발용 파일은 이 `backup/` 폴더로 옮겨 두었습니다.

## 폴더 구성

| 경로 | 내용 |
|------|------|
| `training-server-detector/` | Detector 학습 agent (Python, :9010) |
| `training-server-vlm/` | VLM 학습 agent (Python, :9011) |
| `training-server-deploy/` | Detector agent Docker 빌드/실행 |
| `training-server-vlm-deploy/` | VLM agent Docker 빌드/실행 |
| `intellivix-vlm-agent_1.0.0.tar.gz` | VLM agent Docker 이미지 tar |
| `docker/sync-training-agent.sh` | 학습 서버로 agent 코드 rsync |
| `docs/` | API 계약서, 레퍼런스 스크린샷 |
| `dev/test-data/` | UI 테스트용 샘플 데이터 |
| `dev/tests/` | 백엔드 smoke test |
| `dev/server-workers/` | simulator 모드용 worker (로컬 데모) |

## 모니터링 서버에 필요한 것 (루트)

```
config/mlops-connection.json   ← 배포 시 유일하게 수정
run-intellivix-mlops.sh
Dockerfile / compose.yaml
server/ public/ docker/ config/
workspace/ cache/              ← 실행 시 생성·동기화
```

## 학습 서버 배포 (backup에서)

```bash
# agent 코드를 학습 서버로 복사·빌드
bash backup/docker/sync-training-agent.sh

# 또는 학습 서버에서 직접
cd backup/training-server-deploy/docker && ./build-image.sh && ./run-docker.sh
cd backup/training-server-vlm-deploy/docker && ./build-image.sh && ./run-docker.sh
```

## 복원

루트로 다시 옮기려면 예:

```bash
mv backup/training-server-detector ./
mv backup/training-server-vlm ./
# ...
```
