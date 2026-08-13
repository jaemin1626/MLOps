# Intellivix MLOps 폴더·파일·함수 설명서

이 문서는 프로젝트의 폴더, 파일 역할과 주요 함수의 동작을 한 곳에서 확인할 수 있도록 작성한 개발 안내서입니다.

## 1. 전체 구조

```text
intellivix-mlops/
├── Dockerfile
├── compose.yaml
├── .dockerignore
├── package.json
├── README_KO.md
├── run-intellivix-mlops.sh
├── config/
│   ├── mlops-runtime-config.json
│   └── mlops-runtime-config.docker.json
├── docker/
│   ├── intellivix-mlops-docker.env.example
│   ├── start-intellivix-mlops-docker.sh
│   ├── stop-intellivix-mlops-docker.sh
│   ├── view-intellivix-mlops-docker-logs.sh
│   └── check-intellivix-mlops-docker-status.sh
├── docs/
│   ├── PROJECT_STRUCTURE_AND_FUNCTION_GUIDE.md
│   ├── DOCKER_EXECUTION_GUIDE_KO.md
│   └── reference-dashboard.png
├── public/
│   ├── index.html
│   ├── assets/icons/mlops-icons.svg
│   ├── styles/
│   │   ├── mlops-design-tokens.css
│   │   ├── mlops-layout.css
│   │   ├── mlops-components.css
│   │   ├── mlops-pages.css
│   │   └── yolo-tagging-canvas.css
│   └── scripts/
│       ├── mlops-api-client.js
│       ├── mlops-formatters.js
│       ├── mlops-app-shell.js
│       ├── dashboard-page-controller.js
│       ├── data-browser-page-controller.js
│       ├── yolo-tagging-page-controller.js
│       ├── training-settings-page-controller.js
│       ├── training-monitor-page-controller.js
│       ├── model-list-page-controller.js
│       └── model-export-page-controller.js
├── server/
│   ├── intellivix-mlops-server.js
│   ├── routes/
│   │   └── mlops-api-router.js
│   ├── services/
│   │   ├── runtime-config-service.js
│   │   ├── file-system-inspection-service.js
│   │   ├── yolo-label-service.js
│   │   ├── training-job-service.js
│   │   ├── model-catalog-service.js
│   │   ├── onnx-export-service.js
│   │   └── dashboard-summary-service.js
│   ├── utils/
│   │   ├── atomic-json-file.js
│   │   ├── http-api-helpers.js
│   │   ├── path-security.js
│   │   ├── process-command-builder.js
│   │   └── sse-log-stream.js
│   └── workers/
│       ├── training-process-simulator.js
│       └── onnx-export-process-simulator.js
├── workspace/
│   ├── data/
│   ├── jobs/running|completed|failed/
│   ├── models/
│   ├── exports/
│   └── logs/
└── tests/
    └── backend-smoke-test.js
```

## 2. 루트 파일

### `package.json`

Node.js 프로젝트 정보와 실행 및 테스트 명령을 정의합니다. 런타임 외부 패키지는 사용하지 않습니다.

- `npm start`: MLOps 서버 실행
- `npm run dev`: Node.js Watch 모드 실행
- `npm test`: 백엔드 Smoke Test 실행
- `npm run docker:up`: Docker 이미지 빌드 및 백그라운드 실행
- `npm run docker:down`: Docker Compose 컨테이너 종료
- `npm run docker:logs`: Docker 로그 실시간 확인
- `npm run docker:status`: Docker Compose 상태 확인

### `run-intellivix-mlops.sh`

외부 패키지 설치 없이 Node.js 내장 모듈만으로 서버를 실행하는 Linux용 시작 스크립트입니다.

### `Dockerfile`

Node.js 22 Bookworm Slim 기반 애플리케이션 이미지를 생성합니다. 외부 npm 의존성이 없으므로 별도의 패키지 다운로드 단계 없이 서버, 프론트엔드, 설정과 기본 Workspace를 이미지에 포함합니다. 비루트 사용자, Health Check와 기본 실행 명령을 정의합니다.

### `compose.yaml`

Intellivix MLOps 컨테이너의 빌드, 포트, Bind Mount, 환경 변수, Health Check, 재시작 정책과 보안 옵션을 정의합니다.

### `.dockerignore`

Git 정보, 압축 파일, 로컬 환경 파일과 실행 중 로그처럼 이미지 빌드에 불필요한 항목을 제외합니다.

### `README_KO.md`

설치, 실행, 설정 및 실제 학습 Agent 연동 방법을 설명합니다.

### `docs/reference-dashboard.png`

사용자가 제공한 화면 레퍼런스 이미지입니다. UI 간격, 카드, 사이드바 및 테이블 디자인을 비교할 때 사용합니다.

### `docs/DOCKER_EXECUTION_GUIDE_KO.md`

Docker Compose 실행, 환경 변수, 외부 데이터 폴더 연결, 학습 Agent 주소, 로그, 상태 확인 및 권한 오류 해결 방법을 설명합니다.

## 3. 설정 폴더

### `config/mlops-runtime-config.json`

Node.js 직접 실행 시 사용하는 파일 기반 런타임 설정입니다.

- `server`: 웹 서버 Host와 Port
- `workspaceRoot`: 파일 기반 작업 공간
- `allowedDataRoots`: 데이터 탐색 및 YOLO 저장이 허용된 루트
- `training.executionMode`: `simulator` 또는 `agent`
- `training.agentBaseUrl`: 실제 학습 서버 Agent 주소
- `training.detectorEntryPoint`: 검출기 명령 기본 Entry Point
- `training.vlmEntryPoint`: VLM 명령 기본 Entry Point
- `export.onnxEntryPoint`: ONNX Export 명령 기본 Entry Point
- `paths`: 데이터, 학습, 모델, Export 및 로그 경로
- `scan`: 폴더 트리 깊이와 조회 수 제한

### `config/mlops-runtime-config.docker.json`

Docker 실행 전용 설정입니다. `/app/workspace`를 영구 작업 경로로 사용하고 `/mnt/mlops-data`를 외부 데이터 마운트 경로로 허용합니다. Docker 호스트에서 실행 중인 학습 Agent를 참조할 수 있도록 기본 Agent 주소에 `host.docker.internal`을 사용합니다.

## 4. Docker 실행 파일

### `docker/intellivix-mlops-docker.env.example`

호스트 공개 포트, UID/GID, Workspace 경로, 외부 데이터 경로와 시간대 환경 변수 예시입니다. 프로젝트 루트의 `.env`로 복사하여 사용합니다.

### `docker/start-intellivix-mlops-docker.sh`

Docker 및 Compose를 확인하고, 현재 UID/GID와 필요한 작업 폴더를 준비한 뒤 이미지를 빌드하고 컨테이너를 실행합니다.

### `docker/stop-intellivix-mlops-docker.sh`

`docker compose down`을 실행하여 컨테이너와 Compose 네트워크를 종료합니다. Bind Mount 데이터는 삭제하지 않습니다.

### `docker/view-intellivix-mlops-docker-logs.sh`

Intellivix MLOps 컨테이너의 최근 로그부터 실시간으로 출력합니다.

### `docker/check-intellivix-mlops-docker-status.sh`

Compose 서비스 상태와 컨테이너 Health 상태를 출력합니다.

## 5. 프론트엔드 파일

### `public/index.html`

전체 페이지의 HTML 구조를 포함합니다.

- 좌측 사이드바
- 대시보드
- 데이터 불러오기
- YOLO 태깅
- 학습 설정 및 실행
- 학습 실행 현황
- 모델 목록
- ONNX 모델 배포

각 메뉴는 하나의 `page-section`으로 구성하며 JavaScript가 선택된 Section만 표시합니다.

### `public/assets/icons/mlops-icons.svg`

XML 기반 SVG Symbol Sprite입니다. 사이드바, 카드 및 버튼에서 공통 아이콘을 재사용합니다.

### CSS 파일

- `mlops-design-tokens.css`: 색상, Radius, Shadow, Font 및 공통 변수
- `mlops-layout.css`: 사이드바, 상단 Header, Main Content 및 반응형 레이아웃
- `mlops-components.css`: 카드, 버튼, 폼, 테이블, Badge, Progress, Console 및 Toast
- `mlops-pages.css`: 대시보드, 데이터 탐색, 학습, 모델 및 Export 페이지 전용 레이아웃
- `yolo-tagging-canvas.css`: 태깅 이미지 목록, Canvas 및 Bounding Box 목록 전용 스타일

### `mlops-api-client.js`

#### `request(url, options)`

Fetch API 공통 호출 함수입니다. JSON 응답과 오류 메시지를 표준화합니다.

#### `openEventStream(url, handlers)`

SSE 연결을 생성하고 실시간 로그 이벤트를 전달합니다.

### `mlops-formatters.js`

- `formatBytes(bytes)`: Byte를 KB, MB, GB, TB로 표시
- `formatDate(value)`: ISO 시간을 한국어 날짜·시간으로 표시
- `formatElapsed(seconds)`: 경과 초를 `HH:MM:SS`로 표시
- `escapeHtml(value)`: 테이블 및 옵션 출력 시 HTML Injection 방지
- `badgeForStatus(status)`: 작업 상태를 색상 Badge HTML로 변환
- `formToObject(form)`: 화면의 Form 값을 API 전송 객체로 변환
- `showToast(message, type)`: 성공 또는 오류 Toast 표시

### `mlops-app-shell.js`

#### `navigateTo(pageId)`

선택한 메뉴에 맞게 Section, 사이드바 강조, 제목 및 설명을 변경합니다.

#### `handleError(error)`

API 및 페이지 오류를 Console과 Toast에 표시합니다.

#### `initialize()`

모든 Controller를 초기화하고 Client Config, Health, Dashboard, 학습, 모델 및 Export 정보를 불러옵니다.

### `dashboard-page-controller.js`

- `load()`: 대시보드 API를 호출해 카드, 최근 작업, 로그, 도넛 차트 및 Export 이력을 갱신
- `renderJobs(jobs)`: 최근 학습 테이블 생성
- `renderExports(exports)`: 최근 ONNX Export 테이블 생성
- `renderDistribution(distribution)`: 학습 상태별 Conic Gradient 도넛 차트 생성

### `data-browser-page-controller.js`

- `loadTree()`: 입력한 데이터 루트의 하위 폴더 구조 요청
- `renderTreeNode(node)`: 재귀적으로 폴더 Tree UI 생성
- `loadFolderSummary(path)`: 선택한 폴더의 파일·이미지·라벨 수와 Thumbnail 표시

### `yolo-tagging-page-controller.js`

- `loadImages()`: 이미지 및 라벨 폴더를 기준으로 이미지 목록 조회
- `selectImage(index)`: 기존 라벨 자동 저장 후 선택 이미지와 YOLO 라벨 로드
- `saveCurrentLabels(options)`: Canvas 좌표를 YOLO 정규화 좌표로 변환해 `.txt` 저장
- `pointerDown(event)`: 새 Box 생성, 기존 Box 선택, 이동 또는 Resize 시작
- `pointerMove(event)`: 생성·이동·Resize 중 좌표 갱신
- `pointerUp(event)`: Pointer 작업 종료 및 작은 Box 제거
- `draw()`: 이미지, Bounding Box, 클래스명 및 Resize Handle 렌더링
- `deleteBox(index)`: 선택 Bounding Box 삭제
- `renderBoxList()`: 우측 Bounding Box 목록 갱신

### `training-settings-page-controller.js`

- `updateTypeFields()`: 검출기와 VLM 파라미터 화면 전환
- `preview()`: 학습 명령 미리보기 요청
- `start()`: 학습 작업 생성 후 학습 현황 페이지로 이동
- `parameters()`: 현재 Form 파라미터 객체 생성

### `training-monitor-page-controller.js`

- `loadJobs(preferredJobId)`: 전체 작업과 최신 진행 상태 조회
- `selectJob(jobId)`: 모니터링할 학습 작업 선택
- `openLogStream(jobId)`: 작업별 SSE 로그 연결
- `updateSummary(job)`: Epoch, Step, Loss, 진행률 및 경과 시간 갱신
- `renderTable()`: 전체 학습 현황 테이블 생성

### `model-list-page-controller.js`

- `load()`: 모델 루트 폴더를 스캔한 결과 표시
- `getModels()`: 현재 화면이 보유한 모델 목록 반환

### `model-export-page-controller.js`

- `setModels(models)`: 모델 목록 중 `.pt` 파일만 Select에 구성
- `preview()`: ONNX Export 명령 미리보기 요청
- `start()`: ONNX Export 실행 요청
- `loadExports(preferredId)`: Export 이력과 상태 조회
- `openLog(exportId)`: Export SSE 로그 연결

## 6. 백엔드 Entry Point와 Route

### `server/intellivix-mlops-server.js`

Node.js 내장 `http` 모듈 기반 서버 Entry Point입니다.

- 설정 파일 로드
- 서비스 객체 생성
- API Router 연결
- 정적 웹 파일 제공
- 공통 오류 응답 처리
- `PORT` 환경 변수 또는 설정 Port로 서버 실행

### `server/routes/mlops-api-router.js`

Node.js 내장 HTTP 요청을 Method와 경로에 따라 분기합니다. Dashboard, 데이터 탐색, YOLO 라벨, 학습 작업, 모델 목록, ONNX Export 및 SSE 로그 Endpoint를 한 곳에서 연결합니다.

## 7. 백엔드 서비스

### `runtime-config-service.js`

- `resolveConfigFile()`: `MLOPS_CONFIG_FILE` 환경 변수가 있으면 해당 설정을 선택하고, 없으면 일반 실행 설정을 선택
- `getRuntimeConfig()`: 선택된 JSON 설정을 읽고 상대 경로를 절대 경로로 변환
- `resolveProjectPath(value, configFile)`: 설정 파일 위치를 기준으로 상대 경로 해석

### `file-system-inspection-service.js`

- `buildDirectoryTree(rootPath, options)`: 지정 깊이까지 폴더 Tree 생성
- `scanFolderSummary(folderPath, options)`: 이미지와 YOLO 라벨 현황 집계
- `listImagesRecursively(rootPath, maximumImages)`: 태깅 대상 이미지 재귀 조회
- `diskUsageForPath(targetPath)`: 저장소 전체·사용·여유 용량 계산
- `isImageFile(fileName)`: 지원 이미지 확장자 검사

### `yolo-label-service.js`

- `labelFilePathForImage(imagePath, labelDirectory)`: 동일 Base Name의 `.txt` 경로 생성
- `parseYoloLabelText(text)`: YOLO 5개 필드 파싱 및 좌표 검증
- `loadLabels(imagePath, labelDirectory)`: 기존 라벨 파일 읽기
- `saveLabels(imagePath, labelDirectory, labels)`: 임시 파일을 거쳐 라벨 원자적 저장

### `training-job-service.js`

- `buildTrainingCommand(input, runtimeConfig)`: 검출기 또는 VLM 파라미터 검증과 명령 생성
- `previewCommand(input)`: 실행하지 않고 명령 미리보기 반환
- `startJob(input)`: 작업 폴더와 상태 파일 생성 후 Agent 또는 Simulator 실행
- `startSimulatorJob(...)`: Shell 없이 Node Simulator 프로세스 실행
- `startAgentJob(...)`: 실제 학습 서버 Agent로 안전한 인자 배열 전달
- `listJobs()`: `running`, `completed`, `failed` 폴더의 상태 파일 통합 조회
- `finalizeJob(...)`: 성공·실패 상태 기록, 모델 파일 연결 및 작업 폴더 이동
- `createModelArtifact(...)`: Simulator 완료 모델과 메타데이터 생성
- `applyAgentCallback(jobId, payload)`: Agent의 진행률, 로그, 완료·실패 및 모델 파일 콜백 처리
- `getLogPath(jobId)`: 작업별 로그 파일 위치 조회

### `model-catalog-service.js`

- `listModels()`: 모델 폴더와 `.pt`, `.pth`, `.bin`, `.safetensors`, `.onnx` 파일 스캔
- `findModelByFilePath(filePath)`: Export 대상 파일이 속한 모델 조회

### `onnx-export-service.js`

- `buildExportCommand(input, runtimeConfig)`: `.pt`, 출력명, Shape, Opset 및 옵션 검증 후 명령 생성
- `startExport(input)`: Export 작업 폴더 생성 후 Agent 또는 Simulator 실행
- `listExports()`: 파일 기반 Export 이력 조회
- `finalizeExport(...)`: 종료 코드와 실제 ONNX 파일 존재 여부로 성공·실패 결정
- `applyAgentCallback(exportId, payload)`: Agent의 Export 로그, 상태 및 출력 파일 콜백 처리
- `getLogPath(exportId)`: Export 로그 파일 위치 조회

### `dashboard-summary-service.js`

- `getSummary()`: 학습, 데이터 폴더, 모델, Export 및 저장소 현황 통합
- `tailTextFile(filePath, maximumLines)`: 최근 로그 줄만 읽어 대시보드에 표시

## 8. 공통 Utility

### `atomic-json-file.js`

- `readJsonFile(filePath, fallback)`: JSON 상태 파일 읽기
- `writeJsonFileAtomic(filePath, value)`: 임시 파일 작성 후 Rename하여 손상 방지


### `http-api-helpers.js`

- `sendJson(response, statusCode, payload)`: JSON HTTP 응답 작성
- `readJsonBody(request, maximumBytes)`: 요청 Body 크기 제한과 JSON 파싱
- `streamFile(response, filePath, options)`: 정적 파일 및 이미지 Stream 응답
- `routeMatch(pathname, expression)`: 동적 API 경로의 ID 추출

### `path-security.js`

- `ensureAllowedPath(candidatePath, allowedRoots, options)`: 허용된 데이터 루트 하위 경로인지 검사
- `isPathInside(candidatePath, rootPath)`: Path Traversal 차단용 포함 관계 확인
- `sanitizeFileName(fileName, extension)`: ONNX 출력 파일명 안전화

### `process-command-builder.js`

- `commandPreview(executable, args)`: 사용자 확인용 명령 문자열 생성
- `spawnSafeProcess(executable, args, options)`: Shell을 사용하지 않고 인자 배열로 프로세스 실행

### `sse-log-stream.js`

- `initializeSse(response)`: SSE 응답 Header 설정
- `sendSse(response, eventName, payload)`: 이벤트 전송
- `streamTextFile(response, filePath, options)`: 마지막 Byte Offset부터 로그 파일 변경분 전송

## 9. Worker

### `training-process-simulator.js`

실제 학습 서버 없이도 Epoch, Step, Loss 및 실시간 로그 흐름을 확인할 수 있는 Demo Worker입니다.

### `onnx-export-process-simulator.js`

ONNX 변환 단계 로그를 출력하고 Demo `.onnx` 파일을 생성합니다.

## 10. Workspace

- `workspace/data`: 연동 학습 데이터와 Demo 이미지
- `workspace/jobs/running`: 실행 중 작업
- `workspace/jobs/completed`: 성공 작업
- `workspace/jobs/failed`: 실패 작업
- `workspace/models`: 모델 폴더, 모델 파일 및 `model-metadata.json`
- `workspace/exports`: Export 작업 폴더, 로그 및 생성 ONNX 파일
- `workspace/logs`: 확장용 공통 로그 폴더

DB를 사용하지 않으므로 서버 재시작 시 위 폴더와 JSON 파일을 다시 스캔하여 화면 상태를 복구합니다.


## 11. Docker 볼륨과 컨테이너 경로

- `./config -> /app/config:ro`: 일반 및 Docker 런타임 설정 파일을 읽기 전용으로 연결
- `${MLOPS_WORKSPACE_PATH} -> /app/workspace`: 학습 작업, 모델, Export, 로그와 기본 데이터 영구 저장
- `${MLOPS_EXTERNAL_DATA_PATH} -> /mnt/mlops-data`: 호스트 또는 공유 스토리지의 외부 학습 데이터 연결

Docker 컨테이너는 `MLOPS_CONFIG_FILE=/app/config/mlops-runtime-config.docker.json`을 사용합니다. 일반 Node.js 실행은 `config/mlops-runtime-config.json`을 사용하므로 두 실행 방식의 경로 설정을 분리할 수 있습니다.
