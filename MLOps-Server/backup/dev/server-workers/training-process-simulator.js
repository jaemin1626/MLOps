'use strict';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const jobId = argument('--job-id', 'unknown');
const name = argument('--name', 'training');
const type = argument('--type', 'detector');
const totalEpoch = Math.max(1, Number(argument('--epochs', 10)));
const totalStep = Math.max(totalEpoch, Number(argument('--steps', totalEpoch * 12)));
const startedAt = Date.now();
let step = 0;

function timestamp() {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

console.log(`[${timestamp()}] 학습 시작: ${name} (${type})`);
console.log(`[${timestamp()}] 작업 ID: ${jobId}`);
console.log(`[${timestamp()}] 데이터셋 로드 완료`);

const timer = setInterval(() => {
  step += 1;
  const epoch = Math.min(totalEpoch, Math.floor((step - 1) / Math.max(1, Math.floor(totalStep / totalEpoch))) + 1);
  const loss = Math.max(0.035, 1.15 * Math.exp(-step / Math.max(8, totalStep / 3)) + Math.random() * 0.025);
  const progress = Math.min(100, (step / totalStep) * 100);
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  console.log(`[${timestamp()}] Epoch ${epoch}/${totalEpoch} | Step ${step}/${totalStep} | loss: ${loss.toFixed(4)}`);
  console.log(`__MLOPS_PROGRESS__${JSON.stringify({
    status: 'running', epoch, totalEpoch, step, totalStep,
    loss: Number(loss.toFixed(4)), progress: Number(progress.toFixed(2)),
    elapsedSeconds, updatedAt: new Date().toISOString(),
  })}`);
  if (step >= totalStep) {
    clearInterval(timer);
    console.log(`[${timestamp()}] 최종 체크포인트 저장 완료`);
    setTimeout(() => process.exit(0), 80);
  }
}, 350);
