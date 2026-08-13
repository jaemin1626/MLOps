# MLOps VLM Training Server Agent

Qwen VL 모델 LoRA/Full fine-tuning REST agent (포트 **9011**).

## 구조

```
training-server-vlm/
├── app/                 # Flask REST API
├── train_vlm.py         # Qwen VL 학습 스크립트
├── start.py
└── run-agent.sh
```

## 로컬 실행

```bash
cd training-server-vlm
pip install -r requirements.txt
python start.py
```

## Docker (학습 서버)

```bash
cd training-server-vlm-deploy/docker
VLM_FORCE_REBUILD=1 ./build-image.sh
./restart-docker.sh
```

## MLOps 연동

- UI **이미지 VLM** 학습 탭에서 파라미터 입력 → 명령 생성 → 학습 실행
- MLOps는 `trainingType=vlm` 작업을 **9011 VLM agent**로 라우팅
- 데이터셋: `dataset/vlm/{주제}/Images` + `dataset/vlm/{주제}/label/*.json`

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/health` | 상태 |
| POST | `/api/v1/training/command-preview` | 명령 미리보기 |
| POST | `/api/v1/training/jobs` | 학습 시작 |

## train_vlm.py 주요 인자

- `--dataset` conversations.json 경로
- `--output-dir` 결과 저장 경로
- `--epochs`, `--batch-size`, `--learning-rate`
- `--use-lora` / `--full-finetune`
- `--base-model` (기본: `Qwen/Qwen3-VL-4B-Instruct`)
