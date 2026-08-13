# MLOps Platform

> **MLOps Platform**은 현장 AI 학습 요구 증가와 프로젝트별 반복적인 학습 환경 구축 문제를 해결하기 위한 통합 MLOps 플랫폼입니다.

MLOps Platform은 학습 서버 연결부터 데이터셋 관리, 데이터 태깅, 모델 학습, 학습 모니터링, ONNX Export 및 모델 관리까지 AI 모델 개발 및 배포 과정에 필요한 기능을 하나의 플랫폼에서 제공합니다.

---

## 📌 Overview

AI 프로젝트가 증가함에 따라 프로젝트 또는 현장마다 다음과 같은 작업이 반복적으로 발생합니다.

- 학습 서버 환경 구축
- 데이터셋 업로드 및 관리
- 학습 데이터 라벨링
- 모델별 학습 환경 구성
- 학습 명령 및 파라미터 설정
- 학습 진행 상태 확인
- 학습 모델 Export
- 학습 결과 및 모델 이력 관리

MLOps Platform은 이러한 반복 작업을 통합하여

**데이터 준비 → 학습 → 모니터링 → 모델 Export → 모델 관리**

전체 과정을 하나의 플랫폼에서 수행할 수 있도록 구성되었습니다.

---

## ✨ Main Features

| 구분 | 기능 | 설명 |
|---|---|---|
| Connection | 학습 서버 연결 관리 | 학습 서버 등록, 연결 상태 확인, SSH 인증 및 설정 파일 관리 |
| Dashboard | 통합 대시보드 | 학습 현황, 데이터셋, 모델 배포 상태 확인 |
| Data | 데이터 탐색 | 연동된 데이터 폴더 및 이미지 현황 확인 |
| Data | Object Detection Tagging | Pseudo Labeling을 활용한 객체 검출 라벨 자동 생성 및 수정 |
| Data | Image VLM Tagging | VLM 응답 검수 및 수정을 통한 학습 데이터셋 구축 |
| Training | Object Detector Training | 객체 검출 모델 학습 파라미터 설정 및 실행 |
| Training | Image VLM Training | 이미지 기반 VLM 학습 파라미터 설정 및 실행 |
| Monitoring | Training Monitoring | 실시간 로그 수집 및 학습 진행 상태 모니터링 |
| Export | ONNX Export | 학습 완료 모델의 ONNX 변환 및 Export 이력 관리 |
| Model | Model Management | VLM / Detector 모델 및 배포 현황 관리 |

---

# 1. Connection Management

## 학습 서버 연결 관리

모델 학습에 사용할 원격 학습 서버를 등록하고 관리합니다.

### 주요 기능

- 학습 서버 등록
- 서버 연결 상태 확인
- SSH 인증 관리
- 학습 서버 설정 관리
- 연결된 학습 서버 관리

각 프로젝트마다 학습 서버에 직접 접근하여 환경을 관리하는 대신, MLOps 플랫폼을 통해 서버 연결 정보를 통합적으로 관리할 수 있습니다.

---

# 2. Dashboard

Dashboard에서는 플랫폼의 주요 운영 상태를 한 화면에서 확인할 수 있습니다.

### 확인 가능한 정보

- 현재 학습 현황
- 데이터셋 현황
- 모델 현황
- 배포 상태

여러 학습 작업과 데이터셋 및 모델 상태를 하나의 화면에서 확인할 수 있도록 구성되어 있습니다.

---

# 3. Data Management

MLOps Platform에서는 학습에 사용할 데이터를 탐색하고 태깅하며 관리할 수 있습니다.

```text
Data Management
├── 데이터 불러오기
├── 객체 검출 태깅
└── 이미지 VLM 태깅
```

---

## 3.1 Dataset Explorer

연결된 학습 서버의 데이터 폴더 구조와 이미지 데이터를 확인할 수 있습니다.

### 주요 기능

- 데이터 디렉터리 탐색
- 폴더 구조 확인
- 이미지 목록 확인
- 데이터셋 현황 확인

이를 통해 사용자는 학습 서버에 직접 접근하지 않고 UI를 통해 학습 데이터를 탐색할 수 있습니다.

---

## 3.2 Object Detection Tagging

Object Detection 모델 학습을 위한 Annotation 데이터를 생성하고 관리합니다.

### Pseudo Labeling

기존 모델을 활용한 **Pseudo Labeling**을 통해 객체 Annotation을 자동으로 생성할 수 있습니다.

```text
Image
  │
  ▼
Pseudo Labeling
  │
  ▼
Detection Result
  │
  ▼
Review / Edit
  │
  ▼
Training Dataset
```

자동으로 생성된 결과를 사용자가 검토하고 수정함으로써 수동 Annotation 작업량을 줄일 수 있습니다.

### 주요 기능

- Pseudo Label 자동 생성
- Bounding Box 확인
- Annotation 검토
- Annotation 수정
- 학습 Dataset 구축

---

## 3.3 Image VLM Tagging

이미지 기반 Vision Language Model 학습을 위한 데이터셋을 구축합니다.

VLM이 생성한 응답을 사용자가 빠르게 검수하고 수정할 수 있도록 구성되어 있습니다.

```text
Image
  │
  ▼
VLM Response
  │
  ▼
Review
  │
  ▼
Edit
  │
  ▼
VLM Training Dataset
```

### 주요 기능

- 이미지 데이터 확인
- VLM 응답 확인
- VLM 응답 수정
- 키보드 중심 데이터 검수
- VLM 학습 데이터 구축

---

# 4. Training Management

Object Detector 및 Image VLM 모델의 학습을 관리합니다.

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

현재 플랫폼에서는 다음 객체 검출 학습 환경을 지원합니다.

```text
Ultralytics YOLO
```

### Training Flow

```text
Dataset
   │
   ▼
Training Parameters
   │
   ▼
YAML Configuration
   │
   ▼
Training Command
   │
   ▼
Training
```

### 주요 기능

- 학습 Dataset 선택
- 모델 설정
- Training Parameter 설정
- YAML Configuration 확인
- Training Command 확인
- 모델 학습 실행

---

## 4.2 Image VLM Training

이미지 기반 VLM 모델 학습을 위한 파라미터를 설정하고 학습을 실행합니다.

### Training Flow

```text
VLM Dataset
    │
    ▼
Training Parameters
    │
    ▼
YAML Configuration
    │
    ▼
Training Command
    │
    ▼
VLM Training
```

### 주요 기능

- VLM 학습 Dataset 선택
- Training Parameter 설정
- YAML Configuration 확인
- Training Command 확인
- VLM 모델 학습

---

# 5. Training Monitoring

모델 학습 실행 이후 학습 진행 상태를 실시간으로 확인할 수 있습니다.

학습 서버에서 발생하는 로그를 수집하여 플랫폼에서 확인할 수 있도록 구성되어 있습니다.

### 주요 기능

- 실시간 Training Log 수집
- 학습 진행 상태 확인
- 실행 중인 학습 확인
- 완료된 학습 확인
- 이전 학습 이력 확인

```text
Training Server
      │
      │ Logs
      ▼
MLOps Platform
      │
      ├── Running
      ├── Completed
      └── Training History
```

---

# 6. ONNX Export

학습 완료 모델은 ONNX Export 설정을 통해 배포 가능한 모델 파일로 변환할 수 있습니다.

```text
Training Complete
      │
      ▼
Model Checkpoint
      │
      ▼
ONNX Export
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
- Export History 관리

---

# 7. Model Management

학습된 모델을 통합적으로 관리합니다.

```text
Models
├── Object Detector
└── Vision Language Model
```

### 주요 기능

- 학습 완료 모델 목록 확인
- Detector / VLM 모델 분류
- 모델별 상세 정보 확인
- 학습 모델 이력 관리
- 배포 현황 확인

---

# 8. End-to-End Workflow

전체적인 MLOps Workflow는 다음과 같습니다.

```text
Training Server Connection
            │
            ▼
     Dataset Management
            │
            ▼
       Data Labeling
       ┌────┴────┐
       │         │
   Detection    VLM
    Tagging    Tagging
       │         │
       └────┬────┘
            │
            ▼
   Training Configuration
       ┌────┴────┐
       │         │
   Detector     VLM
   Training   Training
       │         │
       └────┬────┘
            │
            ▼
    Training Monitoring
            │
            ▼
        ONNX Export
            │
            ▼
     Model Management
            │
            ▼
        Deployment
```

---

# 9. Training Server

Detector 및 VLM 모델의 학습을 수행하기 위해 Training Server 환경이 필요합니다.

## Dataset Structure

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

### Object Detector Dataset

```text
Dataset/
└── detector/
    ├── Images/
    └── json/
```

객체 검출 모델 학습에 필요한 Image 및 Annotation 데이터를 저장합니다.

### VLM Dataset

```text
Dataset/
└── vlm/
    ├── Images/
    └── json/
```

Vision Language Model 학습을 위한 Image 및 JSON 데이터를 저장합니다.

---

# 10. Training Server Setup

실제 Repository의 파일명과 Docker Image 이름에 맞춰 Training Server를 구성합니다.

일반적인 실행 흐름은 다음과 같습니다.

```text
Training Server Package
        │
        ▼
Docker Image Load
        │
        ▼
Environment Configuration
        │
        ▼
Training Server Start
```

### Docker Image Load

```bash
docker load -i <detector-agent-image>.tar
docker load -i <vlm-agent-image>.tar
```

### Training Server 실행

```bash
cd <training-server-directory>

bash mlops_train.sh --no-build
```

> 실제 파일명 및 디렉터리명은 Repository 구성에 맞게 설정해야 합니다.

---

# 11. Environment Configuration

Training Server 실행 전 서버 환경에 맞게 다음 설정을 구성합니다.

- GPU
- PORT
- Docker Environment
- Detector Training Environment
- VLM Training Environment

예시:

```text
training-server-deploy/
└── docker/
    └── .env.example

training-server-vlm-deploy/
└── docker/
    └── .env.example
```

환경 설정 파일을 기반으로 각 학습 서버 환경에 필요한 GPU 및 PORT 값을 설정합니다.

---

# 12. Platform Components

| Component | Description |
|---|---|
| Connection Management | 원격 학습 서버 연결 및 SSH 관리 |
| Dashboard | 전체 학습 및 운영 상태 확인 |
| Dataset Explorer | 데이터 폴더 및 이미지 탐색 |
| Detection Tagging | Object Detection Annotation 구축 |
| VLM Tagging | VLM 학습 데이터 구축 |
| Detector Training | Object Detection 모델 학습 |
| VLM Training | Vision Language Model 학습 |
| Training Monitoring | 학습 로그 및 진행 상태 확인 |
| ONNX Export | 학습 완료 모델 Export |
| Model Management | 학습 모델 및 배포 상태 관리 |

---

# 13. Summary

MLOps Platform은 다음 AI 모델 개발 Lifecycle을 하나의 플랫폼으로 통합합니다.

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
Model Export
       ↓
Model Management
       ↓
Deployment
```

이를 통해 프로젝트별로 반복되는 학습 환경 구축 및 데이터 관리 작업을 줄이고, **Object Detector와 VLM 모델의 데이터 구축·학습·배포 프로세스를 통합적으로 관리하는 것**을 목표로 합니다.
