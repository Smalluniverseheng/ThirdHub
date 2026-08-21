/* ThirdHub-Agent JSON-RPC runtime bin（等价官方 dsh-jsonrpc-agent）
   usage: node agent-bin.mjs <path/to/cordis.yml> */
import { existsSync } from 'node:fs';
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot';

const NAME = 'thirdhub-agent-runtime';
installFailLoud(NAME);
loadEnv(NAME);

const fromEnv = process.env['DSH_CORDIS_CONFIG'];
const fromArgv = process.argv[2];
const requested = fromEnv !== undefined && fromEnv !== '' ? fromEnv : (fromArgv !== undefined && fromArgv !== '' ? fromArgv : undefined);
const configPath = requested === undefined ? undefined : resolveConfigPath(requested, undefined);
if (configPath === undefined || !existsSync(configPath)) {
  process.stderr.write('usage: thirdhub-agent-runtime <path/to/cordis.yml>\n');
  process.exit(1);
}

const ctx = await boot(NAME, configPath);
let exiting = false;
async function disposeAndExit(code) {
  if (exiting) return;
  exiting = true;
  try { await ctx.fiber.dispose(); } finally { process.exit(code); }
}
process.stdin.on('end', () => { void disposeAndExit(0); });
process.on('SIGTERM', () => { void disposeAndExit(0); });
process.on('SIGINT', () => { void disposeAndExit(130); });
