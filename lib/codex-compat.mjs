// Oscar's child processes must parse shared configuration with older official
// CLIs too. This is a command-local override: never rewrite config.toml or move
// the account's HOME/CODEX_HOME. Explicit mission effort remains authoritative.
export const CODEX_COMPAT_ARGUMENTS = Object.freeze(['-c', 'model_reasoning_effort="medium"']);
export function codexArguments(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw new TypeError('Arguments Codex invalides.');
  const explicit = args.some((value,index) =>
    (['-c','--config'].includes(value) && /^\s*model_reasoning_effort\s*=/u.test(args[index+1] || '')) ||
    /^--config=\s*model_reasoning_effort\s*=/u.test(value));
  return explicit ? [...args] : [...CODEX_COMPAT_ARGUMENTS, ...args];
}
