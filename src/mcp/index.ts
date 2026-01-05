import type { MCPTransport } from '../config/types';
import { ENV } from '../config/env';
import { log } from '../log';
import { isCfWorker } from '../telegram/utils/tg_utils';

const mcpTools: Record<string, Record<string, any>> = {};
let mcpInitialized = false;
let mcpPromise: Promise<void> | null = null;
const mcpClients: any[] = [];

export async function initializeMcp() {
    if (isCfWorker) {
        log.info('MCP is not supported in worker / browser');
        return;
    }
    if (mcpPromise) {
        return mcpPromise;
    }
    log.info('initializing mcp...');

    try {
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

        const mcpConfig = Object.entries(ENV.MCP_CONFIG);
        const toolPromises = mcpConfig.map(async ([name, transport]: [string, MCPTransport]) => {
            let mcpTransport: any;
            switch (transport.type) {
                case 'stdio':
                    mcpTransport = new StdioClientTransport({
                        command: transport.command,
                        args: transport.args,
                        env: transport.env,
                        cwd: transport.cwd,
                    });
                    break;
                case 'http':
                    mcpTransport = new StreamableHTTPClientTransport(new URL(transport.url));
                    break;
                default:
                    throw new Error(`Unsupported transport type: ${(transport as any).type}`);
            }

            const mcpClient = new Client({
                name,
                version: '1.0.0',
            }, {
                capabilities: {},
            });
            await mcpClient.connect(mcpTransport);
            mcpClients.push(mcpClient);
            const tools = await mcpClient.listTools();
            const toolsMap: Record<string, any> = {};
            tools.tools?.forEach((tool: any) => {
                toolsMap[tool.name] = {
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                };
            });
            Object.assign(mcpTools, {
                [name]: toolsMap,
            });
        });

        await Promise.all(toolPromises);
        mcpInitialized = true;
        log.debug('MCP:', JSON.stringify(Object.entries(mcpTools).map(([name, tools]) => ({ [name]: Object.entries(tools).map(([tname, t]) => ({ name: tname, description: t.description })) })), null, 1));
    } catch (error) {
        log.error('Failed to initialize MCP:', error);
    }
    log.info('initialize mcp done');
    log.info(`mcpTools: ${Object.keys(mcpTools)}`);
}

export async function getMcp() {
    if (!mcpInitialized) {
        await initializeMcp();
    }
    return mcpTools;
}

export async function updateMcp() {
    log.info('updating mcp...');
    await Promise.all(mcpClients.map(mcpClient => mcpClient.close()));
    mcpClients.length = 0;
    mcpPromise = null;
    mcpInitialized = false;
    await initializeMcp();
    return Object.keys(mcpTools);
}

// initializeMcp().catch(console.error);
