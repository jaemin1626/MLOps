'use strict';

const { spawnSync } = require('child_process');

function formatSshError(stderr, stdout, exitCode) {
  const text = `${stderr || ''}\n${stdout || ''}`.trim();
  const lower = text.toLowerCase();

  if (lower.includes('permission denied')) {
    return 'SSH User 또는 Password가 올바르지 않습니다.';
  }
  if (lower.includes('connection refused')) {
    return 'SSH 서버(포트 22)에 연결할 수 없습니다. Host와 방화벽을 확인하세요.';
  }
  if (lower.includes('connection timed out') || lower.includes('timed out')) {
    return 'SSH 연결 시간이 초과되었습니다. Host/네트워크를 확인하세요.';
  }
  if (lower.includes('no route to host')) {
    return 'SSH Host에 접근할 수 없습니다. IP/네트워크를 확인하세요.';
  }
  if (lower.includes('sshpass: not found') || lower.includes('enoent')) {
    return 'SSH 도구(sshpass)가 설치되어 있지 않습니다.';
  }
  if (text) {
    const cleaned = text
      .split('\n')
      .filter((line) => !line.includes('Permanently added') && !line.includes('Warning:'))
      .join('\n')
      .trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return exitCode === 0
    ? 'SSH 인증 응답을 확인하지 못했습니다.'
    : 'SSH 인증에 실패했습니다. User/Password를 확인하세요.';
}

function verifySshCredentials(options = {}) {
  const host = String(options.host || '').trim();
  const user = String(options.user || options.ssh_user || '').trim();
  const password = String(options.password || options.ssh_password || '');
  const timeoutMs = Number(options.timeoutMs || 15000);

  if (!host) {
    throw Object.assign(new Error('SSH host가 필요합니다.'), { statusCode: 400 });
  }
  if (!user) {
    throw Object.assign(new Error('SSH User가 필요합니다.'), { statusCode: 400 });
  }
  if (!password) {
    throw Object.assign(new Error('SSH Password가 필요합니다.'), { statusCode: 400 });
  }

  const result = spawnSync('sshpass', [
    '-p', password,
    'ssh',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=10',
    '-o', 'PreferredAuthentications=password,keyboard-interactive',
    '-o', 'PubkeyAuthentication=no',
    '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'LogLevel=ERROR',
    `${user}@${host}`,
    'echo mlops-ssh-ok',
  ], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      HOME: '/tmp',
    },
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) {
    throw Object.assign(new Error(`SSH 연결 실패: ${result.error.message}`), { statusCode: 401 });
  }
  if (result.status !== 0 || !output.includes('mlops-ssh-ok')) {
    throw Object.assign(
      new Error(formatSshError(result.stderr, result.stdout, result.status)),
      { statusCode: 401 },
    );
  }

  return { host, user, verifiedAt: new Date().toISOString() };
}

module.exports = {
  verifySshCredentials,
  formatSshError,
};
