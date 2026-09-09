export interface ChildProcessEnvironmentOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  overrides?: NodeJS.ProcessEnv;
}

/**
 * Preserves the complete host environment for arbitrary project toolchains.
 * Windows environment keys are case-insensitive, so PATH is normalized to the
 * canonical Path spelling before optional overrides are applied.
 */
export function createChildProcessEnvironment(options: ChildProcessEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const result: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }

  if (platform === 'win32' || platform === 'cygwin') {
    const pathValue = result['Path'] ?? result['PATH'];
    if (pathValue !== undefined) {
      delete result['Path'];
      delete result['PATH'];
      result['Path'] = pathValue;
    }
  }

  return result;
}
