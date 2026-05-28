import { spawn } from 'node:child_process';

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export async function runCommand(command: string, args: string[], options: { cwd?: string; input?: string } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `Command exited with code ${code ?? 1}.`));
    });

    if (options.input) {
      child.stdin.write(options.input);
    }

    child.stdin.end();
  });
}