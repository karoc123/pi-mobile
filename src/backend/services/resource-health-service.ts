import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import type { BackendResourceCheck } from "../../shared/contracts.js";

import type { AppConfig } from "../config.js";

export type ResourceHealthReport = {
  allRequiredAccessible: boolean;
  checks: BackendResourceCheck[];
};

export class ResourceHealthService {
  constructor(private readonly config: AppConfig) {}

  async check(): Promise<ResourceHealthReport> {
    const checks: BackendResourceCheck[] = [];

    checks.push(await this.checkDirectory("workspace_root", "Workspace root", this.config.workspaceRoot, true));
    checks.push(await this.checkWritableFileTarget("costs_db", "Cost DB target", this.config.costsDbPath, true));
    checks.push(await this.checkWritableDirectory("logs_dir", "Logs directory", this.config.logsDirPath, true));

    const piAgentDirPath = this.resolvePiAgentDirPath();
    const piSessionDirPath = this.resolvePiSessionDirPath(piAgentDirPath);
    const piRequired = !this.config.piMockMode;

    checks.push(await this.checkDirectory("pi_agent_dir", "Pi agent directory", piAgentDirPath, piRequired));
    checks.push(await this.checkWritableDirectory("pi_session_dir", "Pi session directory", piSessionDirPath, piRequired));

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
      return path.join(homeDir, ".pi", "agent");
    }

    return path.resolve(".pi", "agent");
  }

  private resolvePiSessionDirPath(piAgentDirPath: string) {
    if (this.config.piSessionDir) {
      return this.config.piSessionDir;
    }

    return path.join(piAgentDirPath, "sessions");
  }

  private async checkDirectory(key: BackendResourceCheck["key"], label: string, directoryPath: string, required: boolean): Promise<BackendResourceCheck> {
    try {
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

  private async checkWritableDirectory(key: BackendResourceCheck["key"], label: string, directoryPath: string, required: boolean): Promise<BackendResourceCheck> {
    try {
      await mkdir(directoryPath, { recursive: true });
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

  private async checkWritableFileTarget(key: BackendResourceCheck["key"], label: string, filePath: string, required: boolean): Promise<BackendResourceCheck> {
    try {
      const parentDir = path.dirname(filePath);
      await mkdir(parentDir, { recursive: true });
      await access(parentDir, fsConstants.R_OK | fsConstants.W_OK);

      try {
        await access(filePath, fsConstants.R_OK | fsConstants.W_OK);
      } catch (error) {
        const code = getErrorCode(error);

        if (code !== "ENOENT") {
          throw error;
        }
      }

      return {
        key,
        label,
        path: filePath,
        required,
        ok: true,
        detail: null,
      };
    } catch (error) {
      return {
        key,
        label,
        path: filePath,
        required,
        ok: false,
        detail: toErrorDetail(error),
      };
    }
  }
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
}

function toErrorDetail(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const code = getErrorCode(error);
  return code ? `${code}: ${error.message}` : error.message;
}
