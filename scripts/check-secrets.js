#!/usr/bin/env node

/**
 * scripts/check-secrets.js
 * Lightweight, zero-dependency credential scanner for pre-commit, CI, and git history.
 *
 * Security rules:
 * 1. NEVER prints, quotes, or logs detected secret values or line contents.
 * 2. Emits only file path, line number (or commit hash), and pattern rule name.
 * 3. Restricts placeholder exemptions strictly to .env.example, and only when the
 *    value is exactly one of: your_key_here, your_api_key_here, or empty.
 * 4. Exits with code 1 upon detection, blocking git commit or CI run.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Common credential patterns (stateless regexes without /g flag)
const SECRET_PATTERNS = [
  {
    name: 'Google / Gemini API Key (AQ format)',
    regex: /AQ\.[0-9A-Za-z_-]{30,}/
  },
  {
    name: 'Google / Gemini API Key (AIzaSy format)',
    regex: /AIzaSy[0-9A-Za-z_-]{30,40}/
  },
  {
    name: 'OpenAI API Key',
    regex: /(?:^|[^a-zA-Z0-9_-])sk-[a-zA-Z0-9_-]{20,}/
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{22,})/
  },
  {
    name: 'Slack Token',
    regex: /xox[baprs]-[0-9A-Za-z-]{10,}/
  },
  {
    name: 'AWS Access Key ID',
    regex: /(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:[^A-Z0-9]|$)/
  },
  {
    name: 'Private Key Header',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/
  },
  {
    name: 'Generic Key/Secret/Token Assignment',
    regex: /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|AUTH_KEY)[_A-Z0-9]*\s*=\s*['"]?[0-9A-Za-z_\-]{24,}['"]?/i
  }
];

// File extensions or names to skip
const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm'
]);

const IGNORE_FILES = new Set([
  'package-lock.json',
  path.relative(repoRoot, __filename).replace(/\\/g, '/')
]);

/**
 * Placeholder exemption is strictly restricted:
 * - May apply ONLY to .env.example
 * - Value must be exactly one of: 'your_key_here', 'your_api_key_here', or empty.
 */
function isExemptPlaceholder(relPath, line) {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized !== '.env.example') {
    return false;
  }

  const match = line.match(/^\s*(?:#\s*)?(?:export\s+)?[A-Za-z0-9_]+\s*=\s*(.*)$/);
  if (!match) {
    return false;
  }

  let val = match[1].trim();
  val = val.replace(/\s+#.*$/, '').trim(); // Remove inline comment if present
  val = val.replace(/^['"]|['"]$/g, '').trim(); // Remove surrounding quotes

  return val === '' || val === 'your_key_here' || val === 'your_api_key_here';
}

function scanContent(relPath, content) {
  const lines = content.split('\n');
  const violations = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    // Check placeholder exemption
    if (isExemptPlaceholder(relPath, line)) {
      continue;
    }

    for (const rule of SECRET_PATTERNS) {
      if (rule.regex.test(line)) {
        violations.push({
          file: relPath.replace(/\\/g, '/'),
          line: lineIndex + 1,
          rule: rule.name
        });
      }
    }
  }

  return violations;
}

function scanFile(relPath) {
  const normalizedRel = relPath.replace(/\\/g, '/');
  if (IGNORE_FILES.has(normalizedRel)) return [];

  const ext = path.extname(relPath).toLowerCase();
  if (IGNORE_EXTENSIONS.has(ext)) return [];

  const fullPath = path.resolve(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) return [];

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return [];
  } catch {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }

  return scanContent(normalizedRel, content);
}

function scanGitHistory() {
  console.log('[check-secrets] Scanning full git history across all commits...');
  const violations = [];

  try {
    const diffOutput = execSync('git log -p -U0 --all', {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    });

    const lines = diffOutput.split('\n');
    let currentCommit = 'UNKNOWN';
    let currentFile = 'UNKNOWN';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('commit ')) {
        currentCommit = line.split(' ')[1].slice(0, 8);
        continue;
      }

      if (line.startsWith('diff --git ')) {
        const parts = line.split(' ');
        if (parts.length >= 4) {
          currentFile = parts[3].replace(/^b\//, '');
        }
        continue;
      }

      // Check added lines only
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const addedContent = line.slice(1);

        if (isExemptPlaceholder(currentFile, addedContent)) {
          continue;
        }

        const ext = path.extname(currentFile).toLowerCase();
        if (IGNORE_EXTENSIONS.has(ext) || IGNORE_FILES.has(currentFile)) {
          continue;
        }

        for (const rule of SECRET_PATTERNS) {
          if (rule.regex.test(addedContent)) {
            violations.push({
              commit: currentCommit,
              file: currentFile,
              rule: rule.name
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[check-secrets] Failed to read git history:', err.message);
    process.exit(1);
  }

  return violations;
}

function getFilesToScan() {
  const args = process.argv.slice(2);
  const scanAll = args.includes('--all') || process.env.CI === 'true';

  try {
    if (scanAll) {
      const output = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' });
      return output.split('\n').map(s => s.trim()).filter(Boolean);
    }

    const explicitFiles = args.filter(a => !a.startsWith('--'));
    if (explicitFiles.length > 0) {
      return explicitFiles;
    }

    // Default pre-commit mode: scan staged files
    const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return output.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    console.error('[check-secrets] Failed to query git status:', err.message);
    process.exit(1);
  }
}

function run() {
  const args = process.argv.slice(2);

  // Mode 1: Full Git History Scan
  if (args.includes('--history')) {
    const historyViolations = scanGitHistory();
    if (historyViolations.length > 0) {
      console.error('\n======================================================');
      console.error(' [SECURITY VIOLATION] Secret pattern(s) found in git history:');
      console.error('======================================================');
      for (const v of historyViolations) {
        console.error(` - Commit ${v.commit} in ${v.file} -> Pattern: ${v.rule}`);
      }
      console.error('\nSecrets detected in history. Ensure revoked and rotated.');
      console.error('======================================================\n');
      process.exit(1);
    }
    console.log('[check-secrets] Passed: Full git history is clean of tracked secret patterns.');
    process.exit(0);
  }

  // Mode 2: Working Tree or Staged Files Scan
  const files = getFilesToScan();
  if (files.length === 0) {
    console.log('[check-secrets] No staged files to scan.');
    process.exit(0);
  }

  const allViolations = [];
  for (const file of files) {
    const violations = scanFile(file);
    if (violations.length > 0) {
      allViolations.push(...violations);
    }
  }

  if (allViolations.length > 0) {
    console.error('\n======================================================');
    console.error(' [SECURITY VIOLATION] Potential secret(s) detected:');
    console.error('======================================================');
    for (const v of allViolations) {
      // NOTE: Never print the secret value or line content.
      console.error(` - ${v.file}:${v.line} -> Pattern: ${v.rule}`);
    }
    console.error('\nCommit blocked. Remove secret values or use placeholders before staging.');
    console.error('======================================================\n');
    process.exit(1);
  }

  console.log(`[check-secrets] Passed: ${files.length} file(s) checked. No unmasked secrets found.`);
  process.exit(0);
}

run();
