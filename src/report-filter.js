const MAX_ENTRIES = 1000;
const MAX_RANGES = 10000;
const reportFilterSchema = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_ENTRIES,
  description:
    'Filter returned findings by project-relative path and inclusive, one-based line ranges. Omit lines to include a complete file. The check and its status still cover the entire project.',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 1024 },
      lines: {
        type: 'array',
        minItems: 1,
        maxItems: 1000,
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: {
            type: 'integer',
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
      },
    },
    required: ['path'],
  },
};
function invalid(message) {
  throw Object.assign(new Error(`report_filter: ${message}`), {
    statusCode: 400,
  });
}
function normalizeReportFilter(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || !input.length || input.length > MAX_ENTRIES)
    invalid(
      `expected 1 to ${MAX_ENTRIES} entries; omit the filter for the full report`,
    );
  const files = new Map();
  let count = 0;
  for (const entry of input) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !['path', 'lines'].includes(key))
    )
      invalid('only path and lines are supported');
    const name = entry.path;
    if (
      typeof name !== 'string' ||
      !name.length ||
      name.length > 1024 ||
      /[\\\x00-\x1f\x7f]/.test(name) ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').some((part) => !part || part === '.' || part === '..')
    )
      invalid(
        'path must be relative with forward slashes and no . or .. segments',
      );
    const ranges = entry.lines;
    if (
      Object.hasOwn(entry, 'lines') &&
      (!Array.isArray(ranges) || !ranges.length || ranges.length > 1000)
    )
      invalid('lines must be a non-empty list of [start, end] ranges');
    if (ranges !== undefined)
      for (const range of ranges) {
        if (
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every((n) => Number.isSafeInteger(n) && n >= 1) ||
          range[0] > range[1]
        )
          invalid('ranges require two positive integers with start <= end');
        if (++count > MAX_RANGES)
          invalid(`too many ranges (maximum ${MAX_RANGES})`);
      }
    if (ranges === undefined) files.set(name, null);
    else if (files.get(name) !== null)
      files.set(name, [
        ...(files.get(name) || []),
        ...ranges.map((range) => [...range]),
      ]);
  }
  return [...files].map(([path, ranges]) => {
    if (ranges === null) return { path };
    const merged = [];
    for (const range of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      const last = merged.at(-1);
      if (last && range[0] - last[1] <= 1)
        last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    return { path, lines: merged };
  });
}

function filterReport(report, filter) {
  if (filter === undefined) return report;
  const paths = new Map(filter.map((entry) => [entry.path, entry.lines]));
  const findings = report.findings.filter(
    (finding) =>
      paths.has(finding.file) &&
      (paths.get(finding.file) === undefined ||
        paths
          .get(finding.file)
          .some(
            ([start, end]) =>
              finding.line <= end &&
              (finding.end_line ?? finding.line) >= start,
          )),
  );
  const counts = new Map(
    report.checks.map((check) => [
      check.id,
      { total: 0, returned: 0, hidden: 0 },
    ]),
  );
  for (const finding of report.findings) counts.get(finding.rule_id).total++;
  for (const finding of findings) counts.get(finding.rule_id).returned++;
  return {
    ...report,
    findings,
    checks: report.checks.map((check) => {
      const stats = counts.get(check.id);
      stats.hidden = stats.total - stats.returned;
      // Preserve whole-project coverage metrics/limitations, but do not resend
      // thousands of unrelated paths and policy/namespace arrays to the agent.
      const coverage = Object.fromEntries(
        Object.entries(check.coverage).filter(
          ([, value]) =>
            value === null ||
            ['string', 'number', 'boolean'].includes(typeof value),
        ),
      );
      const files = check.coverage.files.filter((file) => paths.has(file));
      return {
        ...check,
        finding_counts: stats,
        coverage: {
          ...coverage,
          file_count: check.coverage.files.length,
          files,
          file_list_filtered: true,
        },
      };
    }),
    report_filter: filter,
    report_summary: {
      total_findings: report.findings.length,
      returned_findings: findings.length,
      hidden_findings: report.findings.length - findings.length,
      status_scope: 'project',
      analysis_scope: 'project',
      note: 'The filter affects findings only. Project and check statuses still reflect the full analysis.',
    },
  };
}
module.exports = { reportFilterSchema, normalizeReportFilter, filterReport };
