const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportFilter, filterReport } = require('../src/report-filter');

function report() {
  const finding = (file, line, extra = {}) => ({
    rule_id: 'rule',
    file,
    line,
    severity: 'error',
    message: 'bad',
    evidence: 'code',
    ...extra,
  });
  return {
    status: 'fail',
    scope: 'project',
    snapshot_sha256: 'same-snapshot',
    diagnostics: ['Unchanged diagnostic'],
    checks: [
      {
        id: 'rule',
        status: 'fail',
        implementation_sha256: 'same-implementation',
        coverage: {
          files: ['src/A.kt', 'src/B.kt', 'src/C.kt'],
          step_blocks: 12,
          limitation: 'lexical',
          namespace_roots: ['many', 'unrelated', 'details'],
        },
      },
    ],
    findings: [
      finding('src/A.kt', 5),
      finding('src/A.kt', 10),
      finding('src/A.kt', 20),
      finding('src/A.kt', 30, { end_line: 40 }),
      finding('src/B.kt', 10),
    ],
  };
}

test('no optional filter leaves the complete report unchanged', () => {
  const full = report();
  assert.equal(normalizeReportFilter(undefined), undefined);
  assert.equal(filterReport(full, undefined), full);
});

test('paths and inclusive ranges select findings, with overlaps counted once', () => {
  const filter = normalizeReportFilter([
    {
      path: 'src/A.kt',
      lines: [
        [20, 20],
        [10, 10],
        [10, 20],
        [35, 35],
      ],
    },
  ]);
  assert.deepEqual(filter, [
    {
      path: 'src/A.kt',
      lines: [
        [10, 20],
        [35, 35],
      ],
    },
  ]);
  const result = filterReport(report(), filter);
  assert.deepEqual(
    result.findings.map((f) => f.line),
    [10, 20, 30],
  );
  assert.deepEqual(result.report_summary, {
    total_findings: 5,
    returned_findings: 3,
    hidden_findings: 2,
    status_scope: 'project',
    analysis_scope: 'project',
    note: result.report_summary.note,
  });
  assert.deepEqual(result.checks[0].finding_counts, {
    total: 5,
    returned: 3,
    hidden: 2,
  });
});

test('whole-file entries override ranges and duplicated files are merged', () => {
  const input = [
    { path: 'src/A.kt', lines: [[1, 5]] },
    { path: 'src/B.kt' },
    { path: 'src/A.kt' },
    { path: 'src/A.kt', lines: [[10, 12]] },
  ];
  const original = JSON.stringify(input);
  assert.deepEqual(normalizeReportFilter(input), [
    { path: 'src/A.kt' },
    { path: 'src/B.kt' },
  ]);
  assert.equal(
    filterReport(report(), normalizeReportFilter(input)).findings.length,
    5,
  );
  assert.equal(JSON.stringify(input), original);
});

test('hiding every finding never turns full-project fail or incomplete into pass', () => {
  const full = report(),
    original = JSON.stringify(full);
  const result = filterReport(
    full,
    normalizeReportFilter([{ path: 'src/A.kt', lines: [[100, 200]] }]),
  );
  assert.equal(result.status, 'fail');
  assert.equal(result.checks[0].status, 'fail');
  assert.deepEqual(result.findings, []);
  assert.equal(result.report_summary.hidden_findings, 5);
  assert.deepEqual(result.diagnostics, full.diagnostics);
  assert.equal(result.snapshot_sha256, full.snapshot_sha256);
  assert.equal(
    result.checks[0].implementation_sha256,
    full.checks[0].implementation_sha256,
  );
  assert.equal(JSON.stringify(full), original);
  const incomplete = {
    ...full,
    status: 'incomplete',
    checks: [{ ...full.checks[0], status: 'incomplete' }],
  };
  assert.equal(
    filterReport(incomplete, normalizeReportFilter([{ path: 'missing.kt' }]))
      .status,
    'incomplete',
  );
});

test('filtered coverage omits unrelated paths and detailed arrays but keeps global metrics and limitations', () => {
  const result = filterReport(
    report(),
    normalizeReportFilter([{ path: 'src/B.kt' }]),
  );
  assert.deepEqual(result.checks[0].coverage, {
    files: ['src/B.kt'],
    file_count: 3,
    step_blocks: 12,
    limitation: 'lexical',
    file_list_filtered: true,
  });
});

test('invalid filters fail rather than silently expanding or emptying the selection', () => {
  const invalid = [
    null,
    {},
    [],
    [null],
    [{ path: '/abs/file.kt' }],
    [{ path: '../file.kt' }],
    [{ path: 'src/../file.kt' }],
    [{ path: './file.kt' }],
    [{ path: 'src//file.kt' }],
    [{ path: 'C:/file.kt' }],
    [{ path: 'src\\file.kt' }],
    [{ path: 'src/\nfile.kt' }],
    [{ path: 'x.kt', lines: [] }],
    [{ path: 'x.kt', lines: null }],
    [{ path: 'x.kt', lines: [[0, 1]] }],
    [{ path: 'x.kt', lines: [[2, 1]] }],
    [{ path: 'x.kt', lines: [[1, 1.5]] }],
    [{ path: 'x.kt', lines: [[1]] }],
    [{ path: 'x.kt', lines: [[1, 2, 3]] }],
    [{ path: 'x.kt', lines: [['1', 2]] }],
    [{ path: 'x.kt', lines: [[1, Infinity]] }],
    [{ path: 'x.kt', head: 'sha' }],
    [{ lines: [[1, 2]] }],
    Array.from({ length: 1001 }, () => ({ path: 'x.kt' })),
  ];
  for (const input of invalid)
    assert.throws(
      () => normalizeReportFilter(input),
      (error) => error.statusCode === 400,
      JSON.stringify(input),
    );
  const tooMany = Array.from({ length: 11 }, (_, i) => ({
    path: `${i}.kt`,
    lines: Array.from({ length: 1000 }, () => [1, 1]),
  }));
  assert.throws(() => normalizeReportFilter(tooMany), /too many ranges/);
});
