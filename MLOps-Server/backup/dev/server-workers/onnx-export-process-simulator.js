'use strict';

const fs = require('fs');
const path = require('path');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const source = argument('--source', 'model.pt');
const output = argument('--output', 'model.onnx');
const opset = argument('--opset', '17');
const lines = [
  `원본 모델 확인: ${source}`,
  `ONNX 그래프 생성 (opset=${opset})`,
  '입력 및 출력 Tensor 검사',
  'ONNX 모델 직렬화',
];
let index = 0;

const timer = setInterval(() => {
  console.log(`[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${lines[index]}`);
  index += 1;
  if (index >= lines.length) {
    clearInterval(timer);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `INTELLIVIX DEMO ONNX\nsource=${source}\nopset=${opset}\n`, 'utf8');
    setTimeout(() => process.exit(0), 100);
  }
}, 450);
