import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { stepCountIs, streamText } from 'ai';

let mcpClient;

try {
    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@amap/amap-maps-mcp-server'],
        env: {
            AMAP_MAPS_API_KEY: process.env.AMAP_MAPS_API_KEY!,
        },
    });
    mcpClient = new Client({
        name: 'amap',
        version: '1.0.0',
    }, {
        capabilities: {},
    });
    await mcpClient.connect(transport);

    const tools = await mcpClient.listTools();
    const toolsMap: Record<string, any> = {};
    tools.tools?.forEach((tool: any) => {
        toolsMap[tool.name] = {
            description: tool.description,
            parameters: tool.inputSchema,
        };
    });

    const { textStream } = streamText({
        model: createOpenAICompatible({
            baseURL: process.env.BASE_URL!,
            apiKey: process.env.API_KEY!,
            name: 'oailike',
        }).languageModel('gemini-2.5-pro'),
        stopWhen: stepCountIs(10),
        tools: toolsMap,
        prompt: '上海虹桥站到东方明珠最快路径 开车前往 我不知道经纬度 请使用工具后告诉我最快捷路线',
    });

    for await (const textPart of textStream) {
        process.stdout.write(textPart);
    }
} catch (error) {
    console.error(error);
} finally {
    await mcpClient!.close();
}
