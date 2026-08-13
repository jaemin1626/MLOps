'use strict';

function extractConnectionId(parsedUrl, body = null) {
  const fromQuery = parsedUrl?.searchParams?.get('connection_id');
  if (fromQuery && String(fromQuery).trim()) {
    return String(fromQuery).trim();
  }
  if (body && body.connection_id && String(body.connection_id).trim()) {
    return String(body.connection_id).trim();
  }
  return null;
}

function rejectRawTrainingUrl(body = {}) {
  const forbiddenKeys = ['url', 'detectorUrl', 'vlmUrl', 'trainingServerUrl', 'agentBaseUrl'];
  for (const key of forbiddenKeys) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim()) {
      const error = new Error(`${key} 은(는) 직접 지정할 수 없습니다. connection_id 를 사용하세요.`);
      error.statusCode = 400;
      throw error;
    }
  }
}

module.exports = {
  extractConnectionId,
  rejectRawTrainingUrl,
};
