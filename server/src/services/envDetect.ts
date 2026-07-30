import { execSync } from 'node:child_process';

export interface EnvInfo {
  pandoc: { available: boolean; version: string | null };
  soffice: { available: boolean; path: string | null };
  python: { available: boolean; version: string | null; hasSympy: boolean; hasNumpy: boolean };
  latex: { available: boolean; engine: string | null };
  ai: { available: boolean; provider: string; model: string; baseUrl: string };
}

export function detectEnvironment(): EnvInfo {
  const result: EnvInfo = {
    pandoc: { available: false, version: null },
    soffice: { available: false, path: null },
    python: { available: false, version: null, hasSympy: false, hasNumpy: false },
    latex: { available: false, engine: null },
    ai: { available: false, provider: '', model: '', baseUrl: '' },
  };

  // Detect pandoc
  try {
    const ver = execSync('pandoc --version', { encoding: 'utf-8', timeout: 5000 }).split('\n')[0];
    result.pandoc = { available: true, version: ver };
  } catch { /* not found */ }

  // Detect LibreOffice
  try {
    const out = execSync('where soffice 2>&1', { encoding: 'utf-8', timeout: 5000 }).trim();
    result.soffice = { available: true, path: out.split('\n')[0] || out };
  } catch {
    // Also try common paths on Windows
    try {
      execSync('"C:\\Program Files\\LibreOffice\\program\\soffice.exe" --version', { timeout: 5000 });
      result.soffice = { available: true, path: 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' };
    } catch { /* not found */ }
  }

  // Detect Python + sympy/numpy
  try {
    const pyVer = execSync('python --version 2>&1', { encoding: 'utf-8', timeout: 5000 }).trim();
    result.python.available = true;
    result.python.version = pyVer;
  } catch {
    try {
      const pyVer3 = execSync('python3 --version 2>&1', { encoding: 'utf-8', timeout: 5000 }).trim();
      result.python.available = true;
      result.python.version = pyVer3;
    } catch { /* not found */ }
  }

  if (result.python.available) {
    try {
      execSync('python -c "import sympy" 2>&1', { timeout: 5000 });
      result.python.hasSympy = true;
    } catch { /* no sympy */ }
    try {
      execSync('python -c "import numpy" 2>&1', { timeout: 5000 });
      result.python.hasNumpy = true;
    } catch { /* no numpy */ }
  }

  // Detect LaTeX engine
  for (const engine of ['xelatex', 'latexmk', 'tectonic']) {
    try {
      execSync(`${engine} --version`, { encoding: 'utf-8', timeout: 5000 });
      result.latex = { available: true, engine };
      break;
    } catch { /* try next */ }
  }

  // Detect AI
  const aiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  result.ai = {
    available: !!aiKey,
    provider: process.env.AI_PROVIDER || 'openai',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  };

  return result;
}

export function envReport(env: EnvInfo): string {
  const lines: string[] = ['## 环境探测结果', ''];

  if (env.pandoc.available) {
    lines.push(`- ✅ **pandoc**: ${env.pandoc.version}`);
  } else {
    lines.push(`- ❌ **pandoc**: 未安装 → docx/md 互转不可用，请安装 pandoc`);
  }

  if (env.soffice.available) {
    lines.push(`- ✅ **LibreOffice**: ${env.soffice.path}`);
  } else {
    lines.push(`- ⚠ **LibreOffice**: 未安装 → .doc 旧格式无法转换，请用 Word 另存为 .docx`);
  }

  if (env.python.available) {
    const extras: string[] = [];
    if (env.python.hasSympy) extras.push('sympy');
    if (env.python.hasNumpy) extras.push('numpy');
    lines.push(`- ✅ **Python**: ${env.python.version}${extras.length ? ` (${extras.join(', ')})` : ''}`);
    if (!env.python.hasSympy) {
      lines.push(`  - ⚠ 无 sympy → 计算题验算降级为 numpy 数值验算（pip install sympy 可恢复符号验算）`);
    }
  } else {
    lines.push(`- ❌ **Python**: 未安装 → 计算题验算不可用`);
  }

  if (env.latex.available) {
    lines.push(`- ✅ **LaTeX**: ${env.latex.engine}`);
  } else {
    lines.push(`- ⚠ **LaTeX 引擎**: 未安装 → 跳过本地编译，交付可在 Overleaf(XeLaTeX) 编译的 .tex 源`);
  }

  if (env.ai.available) {
    lines.push(`- ✅ **AI**: ${env.ai.provider} / ${env.ai.model}`);
  } else {
    lines.push(`- ⚠ **AI**: 未配置 → 考点分析/命题退为启发式。设置 AI_API_KEY（和可选的 AI_PROVIDER, AI_MODEL, AI_BASE_URL）启用`);
  }

  return lines.join('\n');
}
