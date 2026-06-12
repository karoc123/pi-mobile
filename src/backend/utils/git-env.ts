type GitIdentity = {
  name: string;
  email: string;
};

type GitSshOptions = {
  privateKeyPath?: string;
  knownHostsPath?: string;
};

export function createGitRuntimeEnv(
  options: {
    baseEnv?: NodeJS.ProcessEnv;
    identity?: GitIdentity;
    ssh?: GitSshOptions;
  } = {},
) {
  const env = {
    ...(options.baseEnv ?? process.env),
  };

  if (options.identity) {
    env.GIT_AUTHOR_NAME = options.identity.name;
    env.GIT_AUTHOR_EMAIL = options.identity.email;
    env.GIT_COMMITTER_NAME = options.identity.name;
    env.GIT_COMMITTER_EMAIL = options.identity.email;
  }

  const sshCommand = createGitSshCommand(options.ssh);

  if (sshCommand) {
    env.GIT_SSH_COMMAND = sshCommand;
  }

  return env;
}

export function createGitSshCommand(options: GitSshOptions | undefined) {
  if (!options?.privateKeyPath || !options.knownHostsPath) {
    return undefined;
  }

  return `ssh -i ${shellEscape(options.privateKeyPath)} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${shellEscape(options.knownHostsPath)}`;
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
