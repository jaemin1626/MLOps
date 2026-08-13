# Intellivix-MLOps

> **Intellivix-MLOps**는 현장 AI 학습 요구 증가와 사업별 반복적인 학습 환경 구축 문제를 해결하기 위한 **통합 MLOps 플랫폼**입니다.

Intellivix-MLOps는 학습 서버 연결부터 데이터셋 관리, 데이터 태깅, 모델 학습, 학습 모니터링, ONNX Export 및 모델 관리까지 AI 모델 개발 및 배포 과정에 필요한 기능을 하나의 플랫폼에서 제공합니다.

---

## 📌 Overview

AI 프로젝트가 증가함에 따라 각 사업 또는 현장마다 다음과 같은 작업이 반복적으로 발생합니다.

- 학습 서버 환경 구축
- 데이터셋 업로드 및 관리
- 학습 데이터 라벨링
- 모델별 학습 환경 구성
- 학습 명령 및 파라미터 설정
- 학습 진행 상태 확인
- 학습 모델 Export
- 학습 결과 및 모델 이력 관리

Intellivix-MLOps는 이러한 반복 작업을 통합하여 **데이터 준비 → 학습 → 모니터링 → 모델 Export → 모델 관리**의 전체 과정을 하나의 플랫폼에서 수행할 수 있도록 구성되었습니다.

---

## ✨ Main Features

| 구분 | 기능 | 설명 |
|---|---|---|
| Connection | 학습 서버 연결 관리 | 학습 서버 등록, 연결 상태 확인, SSH 인증 및 설정 파일 다운로드 |
| Dashboard | 통합 대시보드 | 학습 현황, 데이터셋, 모델 배포 상태 확인 |
| Data | 데이터 탐색 | 연동된 데이터 폴더 및 이미지 현황 확인 |
| Data | Object Detection Tagging | Pseudo Labeling을 이용한 객체 검출 라벨 자동 생성 및 수정 |
| Data | Image VLM Tagging | VLM 응답 검수 및 수정을 통한 학습 데이터셋 구축 |
| Training | Object Detector Training | 객체 검출 모델 학습 파라미터 설정 및 학습 실행 |
| Training | Image VLM Training | 이미지 기반 VLM 학습 파라미터 설정 및 학습 실행 |
| Monitoring | 학습 실행 현황 | 실시간 로그 수집 및 학습 진행 상태 모니터링 |
| Export | ONNX Export | 학습 완료 모델을 ONNX 형식으로 Export 및 이력 관리 |
| Model | 모델 관리 | VLM / Detector 모델 목록, 상세 정보 및 배포 현황 관리 |

---

# 1. Connection Management

## 학습 서버 연결 관리

Intellivix-MLOps에서는 모델 학습에 사용할 원격 학습 서버를 등록하고 관리할 수 있습니다.

주요 기능은 다음과 같습니다.

- 학습 서버 등록
- 서버 연결 상태 확인
- SSH 인증 관리
- 학습 서버 설정 파일 다운로드
- 연결된 학습 서버 관리

이를 통해 각 프로젝트마다 학습 서버를 개별적으로 관리하는 대신 MLOps 플랫폼을 통해 서버 연결 정보를 통합 관리할 수 있습니다.

---

# 2. Dashboard

## 통합 운영 대시보드

Dashboard는 Intellivix-MLOps의 주요 운영 상태를 한 화면에서 확인하기 위한 통합 화면입니다.

다음 정보를 확인할 수 있습니다.

- 현재 학습 현황
- 데이터셋 현황
- 모델 현황
- 배포 상태

여러 학습 작업과 데이터셋 및 배포 모델의 상태를 하나의 화면에서 확인할 수 있도록 구성되어 있습니다.

---

# 3. Data Management

Intellivix-MLOps에서는 학습에 사용할 데이터를 탐색하고 태깅하며 관리할 수 있습니다.

데이터 관리는 크게 다음 기능으로 구성됩니다.

```text
Data Management
├── 데이터 불러오기
├── 객체 검출 태깅
└── 이미지 VLM 태깅
```

---

## 3.1 데이터 불러오기

연결된 학습 서버의 데이터 폴더 구조와 이미지 데이터를 확인할 수 있습니다.

주요 기능:

- 연동된 데이터 디렉터리 탐색
- 데이터 폴더 구조 확인
- 이미지 목록 확인
- 데이터셋 이미지 현황 확인

이를 통해 사용자는 서버에 직접 접근하지 않고 MLOps UI에서 학습 데이터를 탐색할 수 있습니다.

---

## 3.2 객체 검출 태깅

Object Detection 모델 학습을 위한 Annotation을 관리할 수 있습니다.

### Pseudo Labeling

기존 모델을 활용한 **Pseudo Labeling**을 통해 객체 라벨을 자동으로 생성할 수 있습니다.

```text
Image
  │
  ▼
Pseudo Labeling
  │
  ▼
자동 Detection 결과 생성
  │
  ▼
사용자 검토 / 수정
  │
  ▼
학습 Dataset
```

자동 생성된 결과를 사용자가 검토하고 수정함으로써 처음부터 모든 객체를 수작업으로 태깅하는 작업을 줄일 수 있습니다.

### 주요 기능

- Pseudo Label 자동 생성
- Bounding Box 확인
- Annotation 검토
- 잘못된 Annotation 수정
- 학습 데이터셋 구축

---

## 3.3 이미지 VLM 태깅

이미지 기반 Vision Language Model 학습을 위한 데이터셋을 구축할 수 있습니다.

VLM이 생성한 응답을 사용자가 빠르게 검수하고 수정할 수 있도록 구성되어 있으며, 특히 **키보드 중심의 데이터 검수 작업**을 지원합니다.

```text
Image
  │
  ▼
VLM Response
  │
  ▼
응답 검수
  │
  ▼
응답 수정
  │
  ▼
VLM Training Dataset
```

### 주요 기능

- 이미지 데이터 확인
- VLM 응답 확인
- VLM 응답 수정
- 키보드 중심 데이터 검수
- VLM 학습 데이터셋 구축

---

# 4. Training Management

Intellivix-MLOps에서는 Object Detector와 Image VLM의 학습을 관리할 수 있습니다.

```text
Training Management
├── Object Detector Training
├── Image VLM Training
├── Training Monitoring
└── ONNX Export
```

---

## 4.1 Object Detector Training

객체 검출 모델의 학습 파라미터를 UI에서 단계별로 설정하고 학습을 실행할 수 있습니다.

현재 Object Detector 학습에는 다음 모델이 적용되어 있습니다.

```text
Ultralytics-yolov26
```

### Training Flow

```text
Dataset 선택
    │
    ▼
Training Parameter 설정
    │
    ▼
YAML 설정 확인
    │
    ▼
Training Command 확인
    │
    ▼
Training 실행
```

### 주요 기능

- 학습 데이터셋 선택
- 모델 설정
- 학습 파라미터 설정
- YAML Configuration 확인
- Training Command 확인
- 모델 학습 실행

UI에서 설정한 값을 기반으로 실제 학습에 사용할 YAML과 명령어를 확인할 수 있도록 구성되어 있습니다.

---

## 4.2 Image VLM Training

이미지 기반 VLM 모델 학습을 위한 파라미터를 설정하고 학습을 실행할 수 있습니다.

현재 적용된 VLM은 다음과 같습니다.

```text
Qwen3.5
```

### Training Flow

```text
VLM Dataset 선택
    │
    ▼
Training Parameter 설정
    │
    ▼
YAML 확인
    │
    ▼
Training Command 확인
    │
    ▼
VLM Training
```

### 주요 기능

- VLM 학습 데이터셋 선택
- Training Parameter 설정
- YAML Configuration 확인
- 실행 명령어 확인
- VLM 모델 학습

---

# 5. Training Monitoring

모델 학습 실행 이후 학습 진행 상태를 실시간으로 확인할 수 있습니다.

학습 서버에서 발생하는 로그를 수집하여 MLOps 플랫폼에서 확인할 수 있도록 구성되어 있습니다.

### 주요 기능

- 실시간 Training Log 수집
- 학습 진행 상태 확인
- 실행 중인 학습 확인
- 완료된 학습 확인
- 이전 학습 이력 확인

```text
Training Server
      │
      │ Training Log
      ▼
Intellivix-MLOps
      │
      ├── Running
      ├── Completed
      └── Previous Training History
```

이를 통해 사용자는 학습 서버 터미널에 직접 접속하지 않고도 모델 학습 상태를 확인할 수 있습니다.

---

# 6. ONNX Export

학습이 완료된 모델은 ONNX Export 설정을 통해 배포용 모델 파일로 변환할 수 있습니다.

```text
Training 완료
      │
      ▼
Model Checkpoint
      │
      ▼
ONNX Export 설정
      │
      ▼
ONNX Model
      │
      ▼
Deployment
```

### 주요 기능

- 학습 완료 모델 선택
- ONNX Export 설정
- 배포용 모델 파일 생성
- Export 결과 확인
- Export 이력 관리

---

# 7. Model Management

학습된 모델을 통합 관리하기 위한 모델 관리 기능을 제공합니다.

현재 관리 대상은 다음 두 종류의 모델입니다.

```text
Model
├── Object Detector
└── VLM
```

### 주요 기능

- 학습 완료 모델 목록 확인
- Detector / VLM 모델 구분
- 모델별 상세 정보 확인
- 학습 모델 이력 관리
- 모델 배포 현황 확인

이를 통해 여러 학습 결과물을 하나의 화면에서 관리할 수 있습니다.

---

# 8. End-to-End Workflow

Intellivix-MLOps의 전체적인 사용 흐름은 다음과 같습니다.

```text
┌──────────────────────────────┐
│      Training Server 등록     │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│        Dataset 불러오기       │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│         Dataset Tagging       │
│                              │
│  ┌────────────┐ ┌──────────┐ │
│  │ Detection  │ │   VLM    │ │
│  │  Tagging   │ │ Tagging  │ │
│  └────────────┘ └──────────┘ │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│        Training 설정          │
│                              │
│  ┌────────────┐ ┌──────────┐ │
│  │  Detector  │ │   VLM    │ │
│  └────────────┘ └──────────┘ │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│        Training 실행          │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│      실시간 학습 Monitoring    │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│          ONNX Export         │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│         Model Management     │
└──────────────────────────────┘
```

---

# 9. Training Server

Intellivix-MLOps에서 Detector 및 VLM 학습을 실행하기 위해서는 학습 서버에 필요한 파일과 데이터셋을 준비해야 합니다.

## Required Files

| 파일 / 디렉터리 | 설명 |
|---|---|
| `Intellivix_Mlops_train_server.zip` | Detector / VLM 학습 및 데이터셋 저장에 필요한 학습 서버 파일 |
| `Intellivix-detector-agent-1.0.0.tar` | Detector Docker Image |
| `Intellivix-vlm-agent-1.0.0.tar` | VLM Docker Image |
| `Dataset/detector/Images` | Detector 학습 이미지 |
| `Dataset/detector/json` | Detector 학습 Annotation |
| `Dataset/vlm/Images` | VLM 학습 이미지 |
| `Dataset/vlm/json` | VLM 학습 데이터 |

---

## Dataset Structure

학습 데이터는 Detector와 VLM을 구분하여 관리합니다.

```text
Dataset/
├── detector/
│   ├── Images/
│   └── json/
│
└── vlm/
    ├── Images/
    └── json/
```

### Detector Dataset

```text
Dataset/
└── detector/
    ├── Images/
    └── json/
```

객체 검출기 학습을 위한 이미지 및 Annotation 데이터를 저장합니다.

### VLM Dataset

```text
Dataset/
└── vlm/
    ├── Images/
    └── json/
```

VLM 학습을 위한 이미지 및 JSON 데이터를 저장합니다.

---

# 10. Training Server Setup

## 10.1 Training Server 압축 해제

```bash
unzip -d Intellivix_MLops_train_server Intellivix_MLops_train_server.zip
```

---

## 10.2 Detector Docker Image 로드

```bash
docker load -i intellivix-detector-agent-1.0.0.tar
```

---

## 10.3 VLM Docker Image 로드

```bash
docker load -i intellivix-vlm-agent-1.0.0.tar
```

---

## 10.4 Training Server 디렉터리 이동

```bash
cd Intellivix_MLops_train_server
```

---

## 10.5 MLOps Training Server 실행

```bash
bash mlops_train.sh --no-build
```

`--no-build` 옵션을 사용하여 사전에 로드한 Docker Image를 기반으로 서비스를 실행합니다.

---

# 11. Environment Configuration

실행 전 학습 서버 환경에 맞게 GPU 및 PORT 설정이 필요합니다.

Detector와 VLM의 환경 설정 파일은 각각 다음 위치에서 확인할 수 있습니다.

### Detector

```text
training-server-deploy/docker/.env.example
```

### VLM

```text
training-server-vlm-deploy/docker/.env.example
```

학습 서버 환경에 맞게 GPU 및 PORT 관련 설정을 구성한 후 서비스를 실행합니다.

---

# 12. Supported Models

현재 Intellivix-MLOps에서 적용된 모델은 다음과 같습니다.

| Type | Model |
|---|---|
| Object Detection | `Ultralytics-yolov26` |
| Vision Language Model | `Qwen3.5` |

> 현재 플랫폼에서 지원되는 모델 범위이며, 향후 지원 모델은 프로젝트 개발 상황에 따라 변경될 수 있습니다.

---

# 13. Platform Components

전체 플랫폼 기능을 역할 기준으로 정리하면 다음과 같습니다.

| Component | 역할 |
|---|---|
| Connection Management | 원격 학습 서버 연결 및 SSH 관리 |
| Dashboard | 전체 학습 및 운영 상태 확인 |
| Dataset Explorer | 데이터 폴더 및 이미지 탐색 |
| Detection Tagging | 객체 검출 데이터 Annotation 구축 |
| VLM Tagging | VLM 학습용 이미지-응답 데이터 구축 |
| Detector Training | Object Detection 모델 학습 |
| VLM Training | Vision Language Model 학습 |
| Training Monitoring | 학습 로그 및 진행 상태 확인 |
| ONNX Export | 학습 모델 배포 형식 변환 |
| Model Management | 학습 모델 및 배포 현황 관리 |

---

# 14. Summary

Intellivix-MLOps는 다음과 같은 AI 모델 개발 Lifecycle을 하나의 플랫폼으로 통합하는 것을 목표로 합니다.

```text
Server Connection
       ↓
Data Management
       ↓
Data Labeling
       ↓
Training Configuration
       ↓
Model Training
       ↓
Training Monitoring
       ↓
ONNX Export
       ↓
Model Management
       ↓
Deployment
```

이를 통해 현장 및 사업별로 반복되는 학습 환경 구축과 데이터 관리 작업을 통합하고, **Detector 및 VLM 모델의 학습·관리 프로세스를 표준화**할 수 있습니다.

---

## ⚠️ Confidentiality

본 프로젝트 및 관련 자료는 IntelliVIX 내부 자료를 포함할 수 있습니다.

**IntelliVIX의 사전 승인 없이 관련 내용의 전부 또는 일부를 복사, 전재, 배포 또는 외부에서 사용하는 것을 금합니다.**

---

**IntelliVIX · AI 연구소 / ViXA 팀**

Version `1.0`
