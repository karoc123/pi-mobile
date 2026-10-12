import { spawn } from 'node:child_process';

export type CommandResult = { stdout: string; stderr: string };

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; allowedExitCodes?: number[]; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: 'pipe',
      detached: process.platform !== 'win32',
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const terminate = (signal: NodeJS.Signals) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      } else {
        child.kill(signal);
      }
    };
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), 1000);
      killTimer.unref();
    }, options.timeoutMs ?? 120_000);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const output = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (timedOut) {
        reject(new Error('Command timed out.'));
      } else if ((options.allowedExitCodes ?? [0]).includes(code ?? 1)) {
        resolve(output);
      } else {
        reject(
          new Error(
            output.stderr.trim() ||
              output.stdout.trim() ||
              `Command exited with code ${code ?? 1}.`,
          ),
        );
      }
    });
    child.stdin.end(options.input);
  });
}
