import type { SelectedRepo } from "../../shared/contracts.js";

import { PiAgentService } from "./pi-agent-service.js";
import { WatcherService } from "./watcher-service.js";
import { WorkspaceService } from "./workspace-service.js";

export class RepositoryRuntimeService {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly watcherService: WatcherService,
    private readonly piAgentService: PiAgentService,
    private readonly onRepoSelected: (repo: SelectedRepo) => void,
  ) {}

  async initialize() {
    const repo = await this.workspaceService.initializeDefaultRepo();

    if (!repo) {
      return null;
    }

    await this.applySelection(repo);
    return repo;
  }

  async selectRepo(relativePath: string) {
    const repo = await this.workspaceService.selectRepo(relativePath);
    await this.applySelection(repo);
    return repo;
  }

  private async applySelection(repo: SelectedRepo) {
    await this.watcherService.watch(repo.absolutePath);
    await this.piAgentService.selectRepo(repo);
    this.onRepoSelected(repo);
  }
}
