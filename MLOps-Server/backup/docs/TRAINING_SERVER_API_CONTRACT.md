# Training Server REST API contract expected by Intellivix MLOps.
# Implement these endpoints on the training server when executionMode is "remote".

## Health
GET /api/v1/health

## Data
POST /api/v1/data/tree
POST /api/v1/data/summary
GET  /api/v1/data/image?path=

## Tagging
GET  /api/v1/tagging/images?imageDirectory=&labelDirectory=
GET  /api/v1/tagging/labels?imagePath=&labelDirectory=
POST /api/v1/tagging/labels

## Training
GET  /api/v1/training/jobs
GET  /api/v1/training/jobs/:jobId
POST /api/v1/training/command-preview
POST /api/v1/training/jobs
POST /api/v1/training/dataset-config-preview

Request body for dataset-config-preview:
{
  "datasetPath": "dataset/integrated",
  "datasetConfigPath": "detector/configs/data.yaml"
}

Response:
{
  "yaml": "...",
  "absoluteConfigPath": "...",
  "classNames": ["person", "ncar"]
}

Request body for start:
{
  "jobId": "...",
  "executable": "python",
  "args": ["..."],
  "metadata": { ... },
  "callbackUrl": "http://mlops-host:18088/api/training/jobs/{jobId}/callback",
  "parameters": {
    "...": "...",
    "datasetConfigYaml": "optional generated yaml content",
    "datasetConfigAbsolutePath": "/abs/path/detector/configs/data.yaml"
  }
}

Response:
{ "remoteJobId": "...", "pid": 12345 }

## Models
GET /api/v1/models

## Export
GET  /api/v1/exports
POST /api/v1/exports/command-preview
POST /api/v1/exports

Request body for start:
{
  "exportId": "...",
  "executable": "python",
  "args": ["..."],
  "metadata": { ... },
  "callbackUrl": "http://mlops-host:18088/api/model-management/exports/{exportId}/callback",
  "parameters": { ... }
}

## Callbacks (training server -> MLOps)
POST {callbackUrl from start request}

Training callback payload:
{
  "log": "optional line",
  "status": "running|completed|failed",
  "progress": { "epoch", "totalEpoch", "step", "totalStep", "loss", "progress", "elapsedSeconds" },
  "modelFile": "/shared/path/model.pt",
  "errorMessage": "...",
  "exitCode": 0,
  "finishedAt": "ISO8601"
}

Export callback payload:
{
  "log": "...",
  "status": "running|completed|failed",
  "outputPath": "/shared/path/model.onnx",
  "errorMessage": "...",
  "exitCode": 0,
  "completedAt": "ISO8601"
}
