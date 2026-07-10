import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 1430;
const TEST_URL = process.env.TOPPLAN_TEST_URL ?? `http://${HOST}:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 60_000;
const SERVER_POLL_INTERVAL_MS = 250;
const KILL_TIMEOUT_MS = 2_000;

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = join(rootDir, 'node_modules', '@playwright', 'test', 'cli.js');

async function isServerReady() {
  try {
    const response = await fetch(TEST_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${TEST_URL}`);
}

function spawnInherited(command, args, options = {}) {
  return spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
      TOPPLAN_TEST_URL: TEST_URL,
    },
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawnInherited(process.execPath, [playwrightCli, 'test']);
    child.on('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function stopServer(server) {
  if (!server || server.killed) {
    return;
  }

  server.kill();

  if (process.platform === 'win32' && server.pid) {
    spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: KILL_TIMEOUT_MS,
    });
  }
}

let server = null;
let ownsServer = false;

try {
  if (!(await isServerReady())) {
    server = spawnInherited(process.execPath, [viteBin, '--host', HOST, '--port', String(PORT)]);
    ownsServer = true;
    await waitForServer();
  }

  const exitCode = await runPlaywright();
  process.exitCode = exitCode;
} finally {
  if (ownsServer) {
    stopServer(server);
  }
}
