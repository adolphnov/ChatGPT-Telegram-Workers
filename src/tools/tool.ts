/* eslint-disable unused-imports/no-unused-vars */
import type { ToolCallPart, ToolResultPart } from 'ai';
import type { ResponseMessage } from '../agent/types';
import type { AgentUserConfig } from '../config/env';
import type { MessageSender } from '../telegram/utils/send';

import type { FuncTool, ToolResult } from './types';
import { jsonSchema, tool } from 'ai';
import { ENV } from '../config/env';
import { log } from '../log/logger';
import { sendImages } from '../telegram/handler/chat';
import externalTools from './external';
import internalTools from './internal';

export const tools = {
    ...externalTools,
    ...internalTools,
} as Record<string, FuncTool>;
export function executeTool(toolName: string) {
    return async (args: any, options: Record<string, any> & { signal?: AbortSignal }): Promise<{ result: any; time: string }> => {
        const { signal } = options;
        let filledPayload = JSON.stringify(tools[toolName].payload).replace(/\{\{([^}]+)\}\}/g, (match, p1) => args[p1] || match);

        (tools[toolName].required || []).forEach((key: string) => {
            if (!ENV.PLUGINS_ENV[key]) {
                throw new Error(`Missing required key: ${key}`);
            }
            let secret = ENV.PLUGINS_ENV[key];
            // if secret is array, choose one randomly
            if (Array.isArray(secret)) {
                secret = secret[Math.floor(Math.random() * secret.length)];
            }
            filledPayload = filledPayload.replace(`{{${key}}}`, secret);
        });
        // Remove the remaining {{...}}
        filledPayload = filledPayload.replace(/\{\{.*?\}\}/g, '');

        const parsedPayload = JSON.parse(filledPayload);
        const startTime = Date.now();
        log.info(`tool request start, url: ${parsedPayload.url}`);
        let result: any = await fetch(parsedPayload.url, {
            method: parsedPayload.method,
            headers: parsedPayload.headers,
            body: JSON.stringify(parsedPayload.body),
            signal,
        });
        log.info(`tool request end`);
        if (!result.ok) {
            throw new Error(`Tool call error: ${result.statusText}}`);
        }
        if (await result.headers.get('content-type')?.includes('json')) {
            result = await result.json();
        } else {
            result = await result.text();
        }
        /*
        if (tools[toolName].handler) {
            const f = eval(tools[toolName].handler);
            result = f(result);
        }
        */
        if (tools[toolName].next_tool) {
            const next_tool_alias = tools[toolName].next_tool;
            return executeTool(next_tool_alias)(result, options);
        }
        return { result, time: ((Date.now() - startTime) / 1e3).toFixed(1) };
    };
}

export async function vaildTools(tools_config: string[]) {
    await injectFunction();
    // real tool name, not the key name
    const useTools = Object.entries(tools).reduce((acc: Record<string, any>, [name, t]) => {
        const execute = t.buildin ? t.func : executeTool(name) as any;
        acc[t.schema.name] = tool({
            description: t.schema.description,
            parameters: jsonSchema(t.schema.parameters as any),
            execute: t.not_send_to_ai ? undefined : execute,
        });
        return acc;
    }, {});
    // tools key name
    const activeToolAlias = tools_config.filter(t => Object.keys(tools).includes(t));
    return {
        tools: useTools,
        activeToolAlias,
    };
}

export async function manualRequestTool(messages: ResponseMessage[], config: AgentUserConfig) {
    if (messages.at(-1)?.role === 'tool') {
        throw new Error('Maximum steps reached, please increase the number of steps to get the answer');
    }
    const isToolCallResponse = messages.at(-1)?.role === 'assistant'
        && Array.isArray(messages.at(-1)?.content)
        && (messages.at(-1)?.content as (ToolCallPart | ToolResultPart)[]).some(c => c.type === 'tool-call');
    if (!isToolCallResponse) {
        return;
    }
    const toolCallResult = messages.at(-1)?.content as ToolCallPart[];
    messages.push({
        role: 'tool',
        content: [],
    });
    await Promise.all(toolCallResult.filter(c => c.type === 'tool-call').map(async (c) => {
        const tool_func = tools[c.toolName].func || executeTool(c.toolName);
        if (!tool_func) {
            throw new Error(`Tool ${c.toolName} not found`);
        }
        const toolResult = await tool_func(c.args, { signal: undefined }, config);
        (messages.at(-1)?.content as ToolResultPart[]).push({
            type: 'tool-result',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            result: toolResult,
        });
    }));
}

export async function sendToolResult(toolResult: ToolResultPart[], sender: MessageSender, config: AgentUserConfig) {
    const resultType = tools[toolResult.at(-1)?.toolName || '']?.result_type || 'text';
    switch (resultType) {
        case 'text':
            return sender.sendRichText(toolResult.map(r => (r.result as ToolResult).result).join('\n'));
        case 'image': {
            const images = toolResult.map(r => (r.result as ToolResult).result).flat();
            let text = `${images.map(r => r.text ?? '').join('\n-----\n')}`;
            if (text.length > 500) {
                text = `${text.substring(0, 500)}...`;
            }
            return sendImages({
                type: 'image',
                url: images.map(r => r.url).flat(),
                text,
            }, ENV.SEND_IMAGE_AS_FILE, sender, config);
        }
        default:
            break;
    }
}

async function injectFunction() {
    return Promise.all(Object.keys(ENV.PLUGINS_FUNCTION).map(async (plugin) => {
        let template = ENV.PLUGINS_FUNCTION[plugin];
        if (template.startsWith('http')) {
            template = await fetch(template).then(r => r.text());
        }
        try {
            tools[plugin] = JSON.parse(template.trim());
        } catch (e) {
            log.error(`Plugin ${plugin} is invalid`);
        }
    }));
}
