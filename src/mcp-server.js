const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StdioServerTransport,
} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { version } = require('../package.json');
const { runArchitectureCheck } = require('./runner');
const { reportFilterSchema } = require('./report-filter');

const tool = {
  name: 'architecture_check',
  description:
    'Run the configured project’s .architecture/cli.cjs and return its architecture report. The entire working tree is checked, including uncommitted files. A pass applies to the project’s declared checks.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { report_filter: reportFilterSchema },
  },
};

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function createServer(root) {
  const server = new Server(
    { name: 'architecture-check-mcp', version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [tool],
  }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name !== tool.name) return toolError('Unknown tool');
    const args = params.arguments ?? {};
    if (Object.keys(args).some((key) => key !== 'report_filter')) {
      return toolError(
        'Only report_filter is supported. Set the project with --root at server startup.',
      );
    }

    try {
      const report = await runArchitectureCheck(root, {
        reportFilter: args.report_filter,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(report) }],
        structuredContent: report,
      };
    } catch (error) {
      if (error.statusCode === 400) return toolError(error.message);
      return toolError('The architecture check could not run');
    }
  });

  return server;
}

async function main() {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  if (!values.root?.trim())
    throw new Error('Usage: node src/mcp-server.js --root /path/to/project');
  const root = fs.realpathSync(values.root);
  if (!fs.statSync(root).isDirectory())
    throw new Error('--root must be a project directory');
  await createServer(root).connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`architecture-check-mcp: ${error.message}\n`);
    process.exitCode = 1;
  });
}
