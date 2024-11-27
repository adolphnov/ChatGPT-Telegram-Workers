/* eslint-disable unused-imports/no-unused-vars */
import type {
    LanguageModelV1,
    LanguageModelV1CallOptions,
    Experimental_LanguageModelV1Middleware as LanguageModelV1Middleware,
    StepResult,
} from 'ai';
import type { ToolChoice } from '.';
import type { AgentUserConfig } from '../config/env';
import type { ChatStreamTextHandler } from './types';
import { createLlmModel } from '.';
import { getLogSingleton } from '../log/logDecortor';
import { log } from '../log/logger';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

export function AIMiddleware({ config, tools, activeTools, onStream, toolChoice, messageReferencer, chatModel }: { config: AgentUserConfig; tools: Record<string, any>; activeTools: string[]; onStream: ChatStreamTextHandler | null; toolChoice: ToolChoice[] | []; messageReferencer: string[]; chatModel: string }): LanguageModelV1Middleware & { onChunk: (data: any) => void; onStepFinish: (data: StepResult<any>, context: AgentUserConfig) => void } {
    let startTime: number | undefined;
    let sendToolCall = false;
    let step = 0;
    let rawSystemPrompt: string | undefined;
    return {
        wrapGenerate: async ({ doGenerate, params, model }) => {
            log.info('doGenerate called');
            // await warpModel(model, config, activeTools, (params.mode as any).toolChoice, chatModel);
            recordModelLog(config, model, activeTools, (params.mode as any).toolChoice);
            const result = await doGenerate();
            log.debug(`doGenerate result: ${JSON.stringify(result)}`);
            return result;
        },

        wrapStream: async ({ doStream, params, model }) => {
            log.info('doStream called');
            // await warpModel(model, config, activeTools, (params.mode as any).toolChoice, chatModel);
            recordModelLog(config, model, activeTools, (params.mode as any).toolChoice);
            return doStream();
        },

        transformParams: async ({ type, params }) => {
            log.info(`start ${type} call`);
            startTime = Date.now();
            if (!rawSystemPrompt && params.prompt[0]?.role === 'system') {
                rawSystemPrompt = params.prompt[0].content;
            }
            const logs = getLogSingleton(config);
            logs.ongoingFunctions.push({ name: 'chat_start', startTime });
            if (toolChoice.length > 0 && step < toolChoice.length && params.mode.type === 'regular') {
                params.mode.toolChoice = toolChoice[step] as any;
                log.info(`toolChoice changed: ${JSON.stringify(toolChoice[step])}`);
                params.mode.tools = params.mode.tools?.filter(i => activeTools.includes(i.name));
            }
            warpMessages(params, tools, activeTools, rawSystemPrompt);
            return params;
        },

        onChunk: (data: any) => {
            const { chunk } = data;
            log.debug(`chunk: ${JSON.stringify(chunk)}`);
            if (chunk.type === 'tool-call' && !sendToolCall) {
                onStream?.send(`${messageReferencer.join('')}...\n` + `tool call will start: ${chunk.toolName}`);
                sendToolCall = true;
                log.info(`will start tool: ${chunk.toolName}`);
            }
        },

        onStepFinish: (data: StepResult<any>) => {
            const { text, toolResults, finishReason, usage, request, response } = data;
            const logs = getLogSingleton(config);
            log.info('llm request end');
            log.debug('step text:', text);
            log.debug('step raw request:', request);
            // log.debug('step raw response:', response);

            const time = ((Date.now() - startTime!) / 1e3).toFixed(1);
            if (toolResults.length > 0) {
                if (toolResults.find(i => i.result === '')) {
                    throw new Error('Function result is empty');
                }
                let maxFuncTime = 0;
                const func_logs = toolResults.map((i) => {
                    logs.functionTime.push(i.result.time);
                    maxFuncTime = Math.max(maxFuncTime, i.result.time);
                    return {
                        name: i.toolName,
                        arguments: Object.values(i.args),
                    };
                });
                log.info(`func logs: ${JSON.stringify(func_logs, null, 2)}`);
                log.info(`func result: ${JSON.stringify(toolResults, null, 2)}`);
                logs.functions.push(...func_logs);
                logs.tool.time.push((+time - maxFuncTime).toFixed(1));
                const toolNames = [...new Set(toolResults.map(i => i.toolName))];
                activeTools = trimActiveTools(activeTools, toolNames);
                log.info(`finish ${toolNames}`);
                onStream?.send(`${messageReferencer.join('')}...\n` + `finish ${toolNames}`);
            } else {
                activeTools.length > 0 && toolChoice[step]?.type !== 'none' ? logs.tool.time.push(time) : logs.chat.time.push(time);
            }

            if (usage && !Number.isNaN(usage.promptTokens) && !Number.isNaN(usage.completionTokens)) {
                logs.tokens.push(`${usage.promptTokens},${usage.completionTokens}`);
                log.info(`tokens: ${JSON.stringify(usage)}`);
            } else {
                log.warn('usage is none or not a number');
            }
            logs.ongoingFunctions = logs.ongoingFunctions.filter(i => i.startTime !== startTime);
            sendToolCall = false;
            step++;
        },
    };
}

function warpMessages(params: LanguageModelV1CallOptions, tools: Record<string, any>, activeTools: string[], rawSystemPrompt: string | undefined) {
    const { prompt: messages, mode } = params;

    if (messages.at(-1)?.role === 'tool') {
        const content = messages.at(-1)!.content;
        if (Array.isArray(content) && content.length > 0) {
            content.forEach((i: any) => {
                delete i.result.time;
            });
        }
    }
    if (activeTools.length > 0) {
        if (messages[0].role === 'system') {
            messages[0].content = `${rawSystemPrompt}\n\nYou can consider using the following tools:\n##TOOLS${activeTools.map(name =>
                `\n\n### ${name}\n- desc: ${tools[name].description} \n${tools[name].prompt || ''}`,
            ).join('')}`;
        }
    } else {
        (mode as any).tools = undefined;
        messages[0].role === 'system' && (messages[0].content = rawSystemPrompt ?? '');
    }
}

async function warpModel(model: LanguageModelV1, config: AgentUserConfig, activeTools: string[], toolChoice: ToolChoice, chatModel: string) {
    const mutableModel = model as Writeable<LanguageModelV1>;
    const effectiveModel = (activeTools.length > 0 && toolChoice?.type !== 'none') ? (config.TOOL_MODEL || chatModel) : chatModel;
    if (effectiveModel !== mutableModel.modelId) {
        let newModel: LanguageModelV1 | undefined;
        if (effectiveModel.includes(':')) {
            newModel = await createLlmModel(effectiveModel, config);
            // mutableModel.provider = newModel.provider;
            mutableModel.specificationVersion = newModel.specificationVersion;
            mutableModel.doStream = newModel.doStream;
            mutableModel.doGenerate = newModel.doGenerate;
        }
        mutableModel.modelId = newModel?.modelId ?? effectiveModel;
    }
}

function trimActiveTools(activeTools: string[], toolNames: string[]) {
    return activeTools.length > 0 ? activeTools.filter(name => !toolNames.includes(name)) : [];
}

function recordModelLog(config: AgentUserConfig, model: LanguageModelV1, activeTools: string[], toolChoice: ToolChoice) {
    const logs = getLogSingleton(config);
    log.info(`provider: ${model.provider}, modelId: ${model.modelId} `);
    if (activeTools.length > 0 && toolChoice?.type !== 'none') {
        logs.tool.model = model.modelId;
    } else {
        logs.chat.model.push(model.modelId);
    }
}
