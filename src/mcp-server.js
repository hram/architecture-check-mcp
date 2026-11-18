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
const { createProjectResolver } = require('./project-scope');

const tool = {
  name: 'architecture_check',
  description:
    'Run .architecture/cli.cjs in the specified local project and return its architecture report. Rules run against the current working tree, including uncommitted files. A pass applies to the project’s declared checks.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project_path: {
        type: 'string',
        minLength: 1,
        description:
          'Absolute path to the project directory on the MCP server host.',
      },
      report_filter: reportFilterSchema,
    },
    required: ['project_path'],
  },
};

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function createServer(resolveProject) {
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
    if (
      Object.keys(args).some(
        (key) => !Object.hasOwn(tool.inputSchema.properties, key),
      )
    ) {
      return toolError('Only project_path and report_filter are supported');
    }

    let project;
    try {
      project = resolveProject(args.project_path);
    } catch (error) {
      return toolError(error.message);
    }

    try {
      const report = await runArchitectureCheck(project, {
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
  const { values } = parseArgs({
    options: {
      'allow-root': { type: 'string', multiple: true, default: [] },
      'project-manifest': { type: 'string' },
      'project-path-env': { type: 'string' },
    },
  });
  const projectEnv = values['project-path-env'];
  if (
    projectEnv !== undefined &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(projectEnv)
  ) {
    throw new Error('--project-path-env must be an environment variable name');
  }
  const resolveProject = createProjectResolver({
    roots: values['allow-root'],
    manifest: values['project-manifest'],
    boundProject:
      projectEnv === undefined ? undefined : process.env[projectEnv],
  });
  await createServer(resolveProject).connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`architecture-check-mcp: ${error.message}\n`);
    process.exitCode = 1;
  });
}
