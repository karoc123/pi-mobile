import { constants as fsConstants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { BackendResourceCheck } from '../../shared/contracts.js';

import type { AppConfig } from '../config.js';

export type ResourceHealthReport = {
  allRequiredAccessible: boolean;
  checks: BackendResourceCheck[];
};

export class ResourceHealthService {
  constructor(private readonly config: AppConfig) {}

  async check(): Promise<ResourceHealthReport> {
    const piAgentDirPath = this.resolvePiAgentDirPath();
    const piSessionDirPath = this.resolvePiSessionDirPath(piAgentDirPath);

    const checks: BackendResourceCheck[] = await Promise.all([
      this.checkDirectory('workspace_root', 'Workspace root', this.config.workspaceRoot, true),
      this.checkDirectory('logs_dir', 'Logs directory', this.config.logsDirPath, true, true),
      this.checkDirectory('pi_agent_dir', 'Pi agent directory', piAgentDirPath, true),
      this.checkDirectory('pi_session_dir', 'Pi session directory', piSessionDirPath, true, true),
    ]);

    return {
      allRequiredAccessible: checks.every((check) => !check.required || check.ok),
      checks,
    };
  }

  private resolvePiAgentDirPath() {
    if (this.config.piAgentDir) {
      return this.config.piAgentDir;
    }

    const homeDir = process.env.HOME;
    if (homeDir && homeDir.length > 0) {
      return path.join(homeDir, '.pi', 'agent');
    }

    return path.resolve('.pi', 'agent');
  }

  private resolvePiSessionDirPath(piAgentDirPath: string) {
    return this.config.piSessionDir ?? path.join(piAgentDirPath, 'sessions');
  }

  private async checkDirectory(
    key: BackendResourceCheck['key'],
    label: string,
    directoryPath: string,
    required: boolean,
    ensureCreated = false,
  ): Promise<BackendResourceCheck> {
    try {
      if (ensureCreated) {
        await mkdir(directoryPath, { recursive: true });
      }
      await access(directoryPath, fsConstants.R_OK | fsConstants.W_OK);
      return {
        key,
        label,
        path: directoryPath,
        required,
        ok: true,
        detail: null,
      };
    } catch (error) {
      return {
        key,
        label,
        path: directoryPath,
        required,
        ok: false,
        detail: toErrorDetail(error),
      };
    }
  }
}

function getErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function toErrorDetail(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const code = getErrorCode(error);
  return code ? `${code}: ${error.message}` : error.message;
}
