import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ToolAvailability = 'available' | 'not_found' | 'not_executable';
interface ToolDiagnostic {
  available: boolean;
  executable: string | null;
  availability: ToolAvailability;
  error: string | null;
}

export interface EnvInfo {
  pandoc: ToolDiagnostic & { version: string | null };
  soffice: ToolDiagnostic & { path: string | null; version: string | null };
  python: ToolDiagnostic & { version: string | null; hasSympy: boolean; hasNumpy: boolean };
  latex: ToolDiagnostic & { engine: string | null; version: string | null };
  ai: { available: boolean; provider: string; model: string; baseUrl: string };
}

interface ProbeResult extends ToolDiagnostic { version: string | null }
interface DetectionOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: (executable: string, args: string[]) => string;
  findOnPath?: (names: string[]) => string[];
  exists?: (path: string) => boolean;
}

function defaultRun(executable: string, args: string[]): string {
  return execFileSync(executable, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function defaultFindOnPath(names: string[], platform: NodeJS.Platform): string[] {
  const locator = platform === 'win32' ? 'where.exe' : 'which';
  const found: string[] = [];
  for (const name of names) {
    try {
      const output = defaultRun(locator, [name]);
      found.push(...output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    } catch { /* continue */ }
  }
  return found;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function probe(names: string[], configured: string | undefined, commonPaths: string[], versionArgs: string[], options: Required<Pick<DetectionOptions, 'platform' | 'run' | 'findOnPath' | 'exists'>>): ProbeResult {
  const discovered = options.findOnPath(names);
  const candidates = unique([configured, ...commonPaths, ...discovered, ...names]);
  let lastError: string | null = null;
  let foundButUnavailable = false;
  for (const executable of candidates) {
    try {
      const output = options.run(executable, versionArgs);
      return { available: true, executable, availability: 'available', error: null, version: output.split(/\r?\n/)[0]?.trim() || null };
    } catch (error) {
      if (configured === executable || discovered.includes(executable) || (commonPaths.includes(executable) && options.exists(executable))) foundButUnavailable = true;
      lastError = error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error);
    }
  }
  return { available: false, executable: configured ?? discovered[0] ?? null, availability: foundButUnavailable ? 'not_executable' : 'not_found', error: lastError, version: null };
}

export function detectEnvironment(options: DetectionOptions = {}): EnvInfo {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRun;
  const findOnPath = options.findOnPath ?? ((names: string[]) => defaultFindOnPath(names, platform));
  const exists = options.exists ?? existsSync;
  const local = env.LOCALAPPDATA;
  const roaming = env.APPDATA;
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const pandocProbe = probe(['pandoc'], env.PANDOC_EXECUTABLE, unique([
    local ? join(local, 'Pandoc', 'pandoc.exe') : undefined,
    join(programFiles, 'Pandoc', 'pandoc.exe'),
  ]), ['--version'], { platform, run, findOnPath, exists });

  const pythonProbe = probe(['python', 'python3', 'py'], env.PYTHON_EXECUTABLE, unique([
    local ? join(local, 'Programs', 'Python', 'Python313', 'python.exe') : undefined,
    local ? join(local, 'Programs', 'Python', 'Python312', 'python.exe') : undefined,
    local ? join(local, 'Programs', 'Python', 'Python311', 'python.exe') : undefined,
    local ? join(local, 'Programs', 'Python', 'Python38', 'python.exe') : undefined,
  ]), ['--version'], { platform, run, findOnPath, exists });

  const sofficeProbe = probe(['soffice.com', 'soffice', 'libreoffice'], env.SOFFICE_EXECUTABLE, unique([
    join(programFiles, 'LibreOffice', 'program', 'soffice.com'),
    join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
    join(programFilesX86, 'LibreOffice', 'program', 'soffice.com'),
    join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
  ]), ['--version'], { platform, run, findOnPath, exists });

  const latexNames = ['xelatex', 'lualatex', 'latexmk', 'tectonic'];
  const latexProbe = probe(latexNames, env.LATEX_EXECUTABLE, unique([
    local ? join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'xelatex.exe') : undefined,
    roaming ? join(roaming, 'TinyTeX', 'bin', 'win32', 'xelatex.exe') : undefined,
    'C:\\texlive\\2026\\bin\\windows\\xelatex.exe',
    'C:\\texlive\\2025\\bin\\windows\\xelatex.exe',
  ]), ['--version'], { platform, run, findOnPath, exists });

  let hasSympy = false;
  let hasNumpy = false;
  if (pythonProbe.available && pythonProbe.executable) {
    try { run(pythonProbe.executable, ['-c', 'import sympy']); hasSympy = true; } catch { /* unavailable */ }
    try { run(pythonProbe.executable, ['-c', 'import numpy']); hasNumpy = true; } catch { /* unavailable */ }
  }
  const latexBase = latexProbe.executable?.replace(/\.exe$/i, '').split(/[\\/]/).pop()?.toLowerCase() ?? null;
  const engine = latexBase && latexNames.includes(latexBase) ? latexBase : latexProbe.available ? 'xelatex' : null;
  const aiKey = env.AI_API_KEY || env.ANTHROPIC_API_KEY;

  return {
    pandoc: { ...pandocProbe },
    soffice: { ...sofficeProbe, path: sofficeProbe.executable },
    python: { ...pythonProbe, hasSympy, hasNumpy },
    latex: { ...latexProbe, engine },
    ai: { available: Boolean(aiKey), provider: env.AI_PROVIDER || 'openai', model: env.AI_MODEL || 'gpt-4o-mini', baseUrl: env.AI_BASE_URL || 'https://api.openai.com/v1' },
  };
}

function unavailableLabel(tool: ToolDiagnostic): string {
  return tool.availability === 'not_executable' ? '已找到但当前后端进程无法执行' : '未找到';
}

export function envReport(env: EnvInfo): string {
  const lines: string[] = ['## 环境探测结果', ''];
  lines.push(env.pandoc.available ? `- ✅ **pandoc**: ${env.pandoc.version} (${env.pandoc.executable})` : `- ❌ **pandoc**: ${unavailableLabel(env.pandoc)} → docx/md 互转不可用`);
  lines.push(env.soffice.available ? `- ✅ **LibreOffice**: ${env.soffice.version} (${env.soffice.path})` : `- ⚠ **LibreOffice**: ${unavailableLabel(env.soffice)} → .doc 旧格式需先转换为 .docx`);
  if (env.python.available) {
    const extras = [env.python.hasSympy ? 'sympy' : '', env.python.hasNumpy ? 'numpy' : ''].filter(Boolean);
    lines.push(`- ✅ **Python**: ${env.python.version}${extras.length ? ` (${extras.join(', ')})` : ''} (${env.python.executable})`);
    if (!env.python.hasSympy) lines.push('- ⚠ 无 sympy → 符号验算不可用');
  } else lines.push(`- ❌ **Python**: ${unavailableLabel(env.python)} → 计算题验算不可用`);
  lines.push(env.latex.available ? `- ✅ **LaTeX**: ${env.latex.engine} (${env.latex.executable})` : `- ⚠ **LaTeX 引擎**: ${unavailableLabel(env.latex)} → 只交付 .tex 源`);
  lines.push(env.ai.available ? `- ✅ **AI**: ${env.ai.provider} / ${env.ai.model}` : '- ⚠ **AI**: 未配置 → 考点分析/命题退为启发式');
  return lines.join('\n');
}
