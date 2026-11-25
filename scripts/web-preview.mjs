#!/usr/bin/env node
/**
 * Browser preview of the mobile app with the in-app mock API, always on the same port:
 *
 *   pnpm web:mock              http://localhost:8081
 *   pnpm web:mock --clear      same, after clearing Metro's cache (extra args go to `expo start`)
 *   WEB_PORT=8090 pnpm web:mock
 *
 * - Before starting, a leftover Expo server still holding the port is stopped for you. Anything
 *   else on the port is left alone and the script exits with a message.
 * - Ctrl+C (or closing the terminal) stops Expo and every process it started, so nothing keeps
 *   the port and the next run starts on the same one.
 *
 * Lives at the repo root so apps/mobile stays untouched; it only sets env vars and runs Expo there.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileDir = path.join(root, 'apps', 'mobile');
const port = Number(process.env.WEB_PORT ?? 8081);
const isWin = process.platform === 'win32';

/** PIDs listening on the TCP port. */
function listenerPids(p) {
  if (isWin) {
    const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout ?? '';
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // Proto  Local  Foreign  State  PID
      if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${p}`)) {
        const pid = Number(cols[4]);
        if (pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  }
  const out = spawnSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '';
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}

function commandLineOf(pid) {
  if (isWin) {
    const ps = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`;
    return (
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
        .stdout ?? ''
    ).trim();
  }
  return (spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim();
}

/** Kill a process and all its children. */
function killTree(pid) {
  if (isWin) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM'); // whole process group (child is started detached)
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}

// 1. Free the port if a previous Expo run left a server behind.
for (const pid of listenerPids(port)) {
  const cmd = commandLineOf(pid);
  if (/expo/i.test(cmd)) {
    console.log(`Stopping leftover Expo server on port ${port} (PID ${pid}).`);
    killTree(pid);
  } else {
    console.error(
      `Port ${port} is used by another program (PID ${pid}${cmd ? `: ${cmd}` : ''}).\n` +
        `Close it, or pick another port: WEB_PORT=8090 pnpm web:mock`,
    );
    process.exit(1);
  }
}
for (let i = 0; i < 20 && listenerPids(port).length > 0; i++) {
  await new Promise((r) => setTimeout(r, 250));
}
if (listenerPids(port).length > 0) {
  console.error(`Port ${port} is still busy. Try again in a moment.`);
  process.exit(1);
}

// 2. Start Expo directly with node (no shell in between, so Ctrl+C reaches it cleanly).
const expoCli = createRequire(path.join(mobileDir, 'package.json')).resolve('expo/bin/cli');
const env = { ...process.env, EXPO_WEB_PREVIEW: '1', EXPO_PUBLIC_USE_MOCK: '1' };
delete env.CI; // CI mode turns off hot reload
const child = spawn(
  process.execPath,
  [expoCli, 'start', '--web', '--port', String(port), ...process.argv.slice(2)],
  {
    cwd: mobileDir,
    stdio: 'inherit',
    detached: !isWin, // own process group on macOS/Linux so killTree reaches every child
    env,
  },
);

// 3. On Ctrl+C / terminal close / any exit, take the whole Expo tree down with us.
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) killTree(child.pid);
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => stop(0));
process.on('exit', () => {
  if (child.exitCode === null) killTree(child.pid);
});
child.on('exit', (code) => stop(code ?? 0));
