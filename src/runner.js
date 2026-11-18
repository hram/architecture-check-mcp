const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { normalizeReportFilter, filterReport } = require('./report-filter');

const STATUSES = ['pass', 'fail', 'incomplete'];
const incomplete = (request, reason) => ({
  protocol_version: 1,
  request_id: request.request_id,
  scope: 'project',
  status: 'incomplete',
  checks: [],
  findings: [],
  diagnostics: [reason],
});

function validateReport(report, request, exitCode) {
  if (
    !report ||
    report.protocol_version !== 1 ||
    report.request_id !== request.request_id ||
    report.scope !== 'project' ||
    !STATUSES.includes(report.status) ||
    !Array.isArray(report.checks) ||
    !Array.isArray(report.findings) ||
    !Array.isArray(report.diagnostics) ||
    !report.diagnostics.every((value) => typeof value === 'string') ||
    (!report.checks.length &&
      (report.status !== 'incomplete' || !report.diagnostics.length))
  )
    throw new Error('Invalid architecture protocol response');
  const ids = new Set();
  for (const check of report.checks) {
    if (
      !check ||
      typeof check.id !== 'string' ||
      !check.id ||
      ids.has(check.id) ||
      !STATUSES.includes(check.status) ||
      typeof check.version !== 'string' ||
      !check.coverage ||
      !Array.isArray(check.coverage.files) ||
      !check.coverage.files.every((file) => typeof file === 'string') ||
      !/^[a-f0-9]{64}$/.test(check.implementation_sha256) ||
      (check.status === 'pass' && !check.coverage.files.length)
    )
      throw new Error('Invalid check response');
    ids.add(check.id);
  }
  for (const finding of report.findings) {
    if (
      !finding ||
      !ids.has(finding.rule_id) ||
      typeof finding.file !== 'string' ||
      path.isAbsolute(finding.file) ||
      finding.file.split(/[\\/]/).includes('..') ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      (finding.end_line !== undefined &&
        (!Number.isSafeInteger(finding.end_line) ||
          finding.end_line < finding.line)) ||
      !['error', 'warning'].includes(finding.severity) ||
      typeof finding.message !== 'string' ||
      typeof finding.evidence !== 'string'
    )
      throw new Error('Invalid finding response');
  }
  for (const check of report.checks) {
    const errors = report.findings.filter(
      (f) => f.rule_id === check.id && f.severity === 'error',
    );
    if (
      (check.status === 'pass' && errors.length) ||
      (check.status === 'fail' && !errors.length)
    )
      throw new Error('Inconsistent check result');
  }
  const expected =
    report.diagnostics.length ||
    report.checks.some((c) => c.status === 'incomplete')
      ? 'incomplete'
      : report.checks.some((c) => c.status === 'fail')
        ? 'fail'
        : 'pass';
  if (
    report.status !== expected ||
    exitCode !== { pass: 0, fail: 1, incomplete: 2 }[expected]
  )
    throw new Error('Inconsistent status/exit code');
  return report;
}

async function runArchitectureCheck(
  projectPath,
  { timeoutMs = 30000, maxBytes = 2 * 1024 * 1024, reportFilter } = {},
) {
  const filter = normalizeReportFilter(reportFilter);
  const respond = (report) => filterReport(report, filter);
  const request = {
    protocol_version: 1,
    request_id: randomUUID(),
    scope: 'project',
  };
  let root, cli;
  try {
    root = fs.realpathSync(projectPath);
    cli = fs.realpathSync(path.join(root, '.architecture/cli.cjs'));
    const relative = path.relative(root, cli);
    if (
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    ) {
      return respond(
        incomplete(request, 'Project CLI must stay inside the project'),
      );
    }
    if (!fs.statSync(cli).isFile())
      return respond(incomplete(request, 'Project CLI must be a file'));
  } catch {
    return respond(
      incomplete(
        request,
        'Project .architecture/cli.cjs is missing or unreadable',
      ),
    );
  }
  return new Promise((resolve) => {
    let stdout = '',
      bytes = 0,
      finished = false,
      failure = null;
    const decoder = new StringDecoder('utf8');
    // Fixed executable and entrypoint; callers cannot supply commands or arguments.
    const child = spawn(process.execPath, [cli], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '',
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
      },
      detached: process.platform !== 'win32',
    });
    const stop = (reason) => {
      failure ||= reason;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => stop('Project CLI timed out'), timeoutMs);
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(respond(value));
    };
    child.on('error', () =>
      finish(incomplete(request, 'Project CLI could not start')),
    );
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) stop('Project CLI output limit exceeded');
      else stdout += decoder.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) stop('Project CLI output limit exceeded');
    });
    child.on('close', (code) => {
      stdout += decoder.end();
      if (failure) return finish(incomplete(request, failure));
      try {
        finish(validateReport(JSON.parse(stdout), request, code));
      } catch (error) {
        finish(incomplete(request, error.message));
      }
    });
    child.stdin.end(JSON.stringify(request) + '\n');
  });
}
module.exports = { runArchitectureCheck, validateReport };
