const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exitCode = { pass: 0, fail: 1, incomplete: 2 };

function run(report) {
  const manifest = require('./manifest.json');
  const files = new Map();
  report.project = manifest.project;
  if (manifest.checks.length === 0)
    throw new Error('No architecture checks are declared');

  for (const rule of manifest.checks) {
    const implementation = path.join(__dirname, rule.module);
    const implementationHash = hash([
      manifest,
      fs.readFileSync(__filename, 'utf8'),
      fs.readFileSync(implementation, 'utf8'),
    ]);
    try {
      const result = require(implementation).check(root);
      for (const { file, source } of result.inputs) files.set(file, source);
      const findings = result.findings.map((finding) => ({
        ...finding,
        rule_id: rule.id,
      }));
      report.findings.push(...findings);
      report.checks.push({
        id: rule.id,
        version: rule.version,
        implementation_sha256: implementationHash,
        status: findings.some((finding) => finding.severity === 'error')
          ? 'fail'
          : 'pass',
        coverage: result.coverage,
      });
    } catch (error) {
      report.diagnostics.push(rule.id + ': ' + error.message);
      report.checks.push({
        id: rule.id,
        version: rule.version,
        implementation_sha256: implementationHash,
        status: 'incomplete',
        coverage: { files: [] },
      });
    }
  }

  report.snapshot_sha256 = hash(
    [...files.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  report.status = report.diagnostics.length
    ? 'incomplete'
    : report.checks.some((check) => check.status === 'fail')
      ? 'fail'
      : 'pass';
}

const report = {
  protocol_version: 1,
  request_id: '',
  scope: 'project',
  status: 'incomplete',
  checks: [],
  findings: [],
  diagnostics: [],
};

try {
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (typeof request?.request_id === 'string')
    report.request_id = request.request_id;
  if (
    request?.protocol_version !== 1 ||
    request.scope !== 'project' ||
    !report.request_id
  ) {
    throw new Error(
      'Expected protocol_version 1, a request_id and scope project',
    );
  }
  run(report);
} catch (error) {
  report.diagnostics.push(error.message);
}

process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = exitCode[report.status];
