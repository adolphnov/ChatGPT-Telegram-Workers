/* eslint-disable no-case-declarations */
/* eslint-disable unused-imports/no-unused-vars */
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Prompt } from '@ai-sdk/provider';
import type { ModelMessage, StepResult, TextStreamPart, ToolCallPart, ToolResultPart } from 'ai';
import type { AgentUserConfig } from '../config/env';
import type { LogStruct } from '../log';
import type { ToolResult } from '../tools/types';
import type { ChatStreamTextHandler } from './types';
import {
    extractReasoningMiddleware,
    wrapLanguageModel,
} from 'ai';
import { ENV } from '../config/env';
import { getLogSingleton, log } from '../log';
import { getTools, sendToolResult, validTools } from '../tools';
import { createLlmModel } from './llm';

type Writeable<T> = { -readonly [P in keyof T as P extends 'modelId' ? P : never]: T[P] };
export interface MessageInfo {
    content: string;
    // reasoning: string;
    occured_error?: boolean;
};

export async function AIMiddleware({ config, activeTools, onStream, toolChoice, messageInfo, chatModel }: { config: AgentUserConfig; activeTools: string[]; onStream: ChatStreamTextHandler | null; toolChoice: ToolChoice[] | []; messageInfo: MessageInfo; chatModel: string }): Promise<Record<string, ((...args: any[]) => any)>> {
    let step = 0;
    let rawSystemPrompt: string | undefined;
    const extractReasoning = extractReasoningMiddleware({ tagName: 'think' });
    const tools = await getTools();
    let hasRecordFirstChunkTime = false;
    let record: LogStruct;
    let currentModel: LanguageModelV3;
    // chunk内容修改导致收集的message一并修改，暂恢复原think处理逻辑
    // const thinkingTag = '>`Thinking\\.\\.\\.`';
    // let thinkingStart = false;
    // const chunkWrapper = (data: TextStreamPart<any>) => {
    //     switch (data.type) {
    //         case 'reasoning':
    //             if (!ENV.SHOW_THINKING_TEXT) {
    //                 data.text = '';
    //                 break;
    //             }
    //             if (!thinkingStart) {
    //                 thinkingStart = true;
    //                 // thinking转为引用
    //                 data.text = `${thinkingTag}\n>${data.text.replace(/\n/g, '\n>')}`;
    //                 break;
    //             }
    //             data.text = data.text.replace(/\n/g, '\n>');
    //             break;
    //         case 'text':
    //             if (!thinkingStart)
    //                 break;
    //             thinkingStart = false;
    //             const thinkingTime = ((Date.now() - record!.start_time) / 1e3).toFixed(1);
    //             messageInfo.content = messageInfo.content
    //                 .replace(thinkingTag, `>\`Thought for ${thinkingTime} seconds\``)
    //                 .replace(/(\n>)*$/g, '');
    //             data.text = `\n>✹\n${SEGMENTATION_MARK}\n${data.text}`;
    //             break;
    //         case 'tool-call':
    //             onStream?.send(`${messageInfo.content.trimEnd()}\n\n` + `tool call start: \`${data.toolName}\``);
    //             log.info(`start tool: ${data.toolName}`);
    //             break;
    //     }
    // };

    return {
        prepareStepPre: (middleware: any) => async ({ model, stepNumber, steps }: { model: LanguageModelV3; stepNumber: number; steps: StepResult<any>[] }) => {
            currentModel = model;
            if (activeTools.length > 0) {
                // (model as Writeable<LanguageModelV2>).modelId = config.TOOL_MODEL;
                currentModel = wrapLanguageModel({
                    model: await createLlmModel(config.TOOL_MODEL, config),
                    middleware,
                });
            }
            record = getLogSingleton({ config });
            // record model log
            recordModelLog({ config, model: currentModel, record });
            // google已支持youtube url以及内部文件url，但未支持其他外部url
            if (currentModel.provider.startsWith('google') && model.modelId.startsWith('gemini-2')) {
                currentModel.supportedUrls = {
                    '*': [/^https:\/\/generativelanguage.googleapis.com\/v1beta\/files\/.*$/, /^https?:\/\/(youtu\.be|www\.youtube\.com)\/.+/],
                };
            }

            return {
                model: currentModel,
            };
        },

        wrapGenerate: async ({ doGenerate, params, model }: { doGenerate: () => Promise<any>; params: any; model: LanguageModelV3 }) => {
            return extractReasoning.wrapGenerate!({ doGenerate, doStream: () => model.doStream(params), params, model });
        },

        wrapStream: async ({ doStream, params, model }: { doStream: () => Promise<any>; params: any; model: LanguageModelV3 }) => {
            return extractReasoning.wrapStream!({ doStream, doGenerate: () => model.doGenerate(params), params, model });
        },

        transformParams: async ({ type, params }: { type: 'generate' | 'stream'; params: LanguageModelV3CallOptions }) => {
            log.info(`start ${type} call`);

            // transform tool choice
            if (activeTools.length > 0 && toolChoice.length > 0 && step < toolChoice.length) {
                const toolChoiceItem = toolChoice[step] as any;
                log.info(`toolChoice changed: ${JSON.stringify(toolChoiceItem)}`);
                params.toolChoice = toolChoiceItem;
            }
            // tool result as message
            if (params.prompt.at(-1)?.role === 'tool') {
                log.info(`detect last message is tool result, handle tool result`);
                const toolResults = params.prompt.at(-1)?.content as unknown as ToolResultPart[];
                await handleToolResult({ tools, toolResults, onStream, config });
                log.debug(`last tool result: ${JSON.stringify(toolResults, null, 2)}`);
            }
            if (!rawSystemPrompt) {
                rawSystemPrompt = params.prompt.find((i: any) => i.role === 'system')?.content as string;
            }
            // warp messages
            const isResponseApi = currentModel.provider.endsWith('.responses');
            warpMessages(params, tools, activeTools, isResponseApi, rawSystemPrompt);
            return params;
        },

        onChunk: ({ chunk }: { chunk: TextStreamPart<any> }) => {
            if (!hasRecordFirstChunkTime) {
                record.first_chunk_time = Date.now() - record.start_time;
                hasRecordFirstChunkTime = true;
            }
            // chunkWrapper(chunk);
            if (chunk.type === 'tool-call') {
                onStream?.send(`${messageInfo.content.trimEnd()}\n\n` + `tool call start: \`${chunk.toolName}\``);
                log.info(`start tool: ${chunk.toolName}`);
            }
        },

        onStepFinish: async ({ text, toolResults, usage, request, response, finishReason }: StepResult<any>) => {
            log.info('llm request end');
            log.debug('step text:', text);
            log.debug('step raw request:', request);
            // log.debug('step raw response:', response);

            // record end time
            record.end_time = Date.now();

            // record tool call detail4
            if (toolResults.length > 0) {
                const func_logs = toolResults.map(({ toolName, input, output }: { toolName: string; input: any; output: any }) => ({
                    name: toolName,
                    args: Object.values(input as any),
                    ...(output.content.some((i: any) => i.is_error) && { error: output.map((i: any) => i.text).join('\n') }),
                    ...(output.time && { time: output.time }),
                }));

                // record function log
                record.functions.push(...func_logs);

                // delete time
                // ai sdk无api能调整函数结果，但内部记录stepMessages， result未做深拷贝 由此可以直接对数据直接进行修改
                toolResults.forEach(({ output }: any) => output.time && (delete output.time));

                log.info(`tool details: ${JSON.stringify(func_logs, null, 2)}`);
                log.debug(`tool results: ${JSON.stringify(toolResults, null, 2)}`);

                const toolNames = [...new Set(toolResults.map(i => i.toolName))];
                log.info(`finish tools: ${toolNames}`);
                onStream?.send(`${messageInfo.content.trimEnd()}\n\n` + `finish tools: \`${toolNames}\``);
            }

            // record token
            if (usage && usage.inputTokens && usage.outputTokens) {
                record.tokens = {
                    prompt: usage.inputTokens,
                    completion: usage.outputTokens,
                    reasoning: usage.reasoningTokens,
                    cached: usage.cachedInputTokens,
                };
                log.info(`tokens: ${JSON.stringify(usage)}`);
            } else {
                log.warn('usage is none');
            }

            // reset tool message status
            hasRecordFirstChunkTime = false;
            step++;
        },
    };
}

function warpMessages(params: LanguageModelV3CallOptions, allTools: Record<string, any>, activeTools: string[], isResponseApi: boolean, rawSystemPrompt: string | undefined) {
    const { prompt: messages, tools } = params;

    const getSystemContent = () => {
        let systemContent = rawSystemPrompt ?? '';
        // 插入工具prompt
        if (activeTools.length > 0) {
            systemContent += `\nYou can consider using the following tools:\n${activeTools.map(name =>
                `### ${name}\n- desc: ${allTools[name]?.schema?.description || ''} \n${allTools[name]?.prompt || ''}`,
            ).join('\n\n')}`
            + `\n\n${activeTools.map(name => allTools[name]?.prompt && `## For tool \`${name}\`, you should follow these rules:\n - ${allTools[name]?.prompt}`)
                .join('\n')}`;
        }
        return systemContent ?? 'You are a helpful assistant';
    };

    const trimMessages = (messages: ModelMessage[]) => {
        const modifiedMessages: any[] = [];
        for (const [i, message] of messages.entries()) {
            switch (message.role) {
                case 'system':
                    modifiedMessages.push({
                        role: 'system',
                        content: getSystemContent(),
                    });
                    continue;
                case 'assistant':
                    if (Array.isArray(message.content) && message.content.every(i => i.type !== 'tool-call')) {
                        modifiedMessages.push(message);
                    }
                    continue;
                case 'tool':
                    const preMessage = messages[i - 1];
                    // if (i > 0 && isResponseApi && messages[i - 1].content)
                    let text = '';
                    const toolNames: Set<string> = new Set();
                    for (const toolResultPart of message.content) {
                        const { toolCallId, toolName, output } = toolResultPart as ToolResultPart;
                        let arrayResult;
                        if (output.type === 'text' || output.type === 'json') {
                            arrayResult = output.value;
                        } else if (output.type === 'execution-denied') {
                            arrayResult = { error: output.reason || 'Execution denied' };
                        } else if (output.type === 'error-text') {
                            arrayResult = { error: output.value };
                        } else {
                            arrayResult = { error: 'Unknown error' };
                        }
                        toolNames.add(toolName);
                        let toolArgs = 'UNKNOWN';
                        if (preMessage?.role === 'assistant' && (preMessage?.content as any[])?.some(i => i.type === 'tool-call')) {
                            toolArgs = JSON.stringify((preMessage?.content as ToolCallPart[])?.find(i => i.toolCallId === toolCallId)?.input) || 'UNKNOWN';
                        }
                        text += `#### [tool \`${toolName}\` invoke detail]\n - args: ${toolArgs}\n - result:\n${JSON.stringify(arrayResult)}\n\n`;
                    }
                    text = `### Please use the following retrieved data to answer my question:\n${text}`;
                    modifiedMessages.push({
                        role: 'user',
                        content: [{ type: 'text', text }],
                    });
                    continue;
                case 'user':
                    modifiedMessages.push(message);
                    continue;
            }
        }
        return modifiedMessages;
    };

    if (tools && activeTools.length === 0) {
        tools.length = 0;
    }
    if (ENV.MESSAGE_COMPATIBLE) {
        params.prompt = trimMessages(messages);
    } else {
        const systemMessage = messages[0].role === 'system' ? messages[0] : undefined;
        if (systemMessage) {
            systemMessage.content = getSystemContent();
            params.prompt.shift();
        }
        // if the first message is tool call, inject a user message to use the tool to avoid gemini error
        const firstMessage = params.prompt[0];
        const firstIsToolCall = Array.isArray(firstMessage?.content) && firstMessage?.content.some((c: any) => c.type === 'tool-call');
        if (firstIsToolCall) {
            params.prompt.unshift({
                role: 'user',
                content: [{ type: 'text', text: 'Use the tool to answer my question.' }],
            });
        }
        systemMessage && params.prompt.unshift(systemMessage);
    }
    // 处理response api异常情况
    isResponseApi && (params.prompt = handleResponseApiMessage(messages));
}

function warpModel(model: LanguageModelV3, config: AgentUserConfig, activeTools: string[], toolChoice: ToolChoice, chatModel: string) {
    const mutableModel = model as Writeable<LanguageModelV3>;
    const effectiveModel = (activeTools.length > 0 && toolChoice?.type !== 'none') ? (config.TOOL_MODEL || chatModel) : chatModel;
    if (effectiveModel !== mutableModel.modelId) {
        let newModel: LanguageModelV3 | undefined;
        mutableModel.modelId = newModel?.modelId ?? effectiveModel;
    }
}

export async function warpLLMParams({ messages, model, cache }: { messages: ModelMessage[]; model: LanguageModelV3; cache?: string[] }, context: AgentUserConfig) {
    const allTools = await getTools();
    const userMessage = messages.findLast(m => m.role === 'user')!;
    // support text message and text part
    const userText = Array.isArray(userMessage.content) ? userMessage.content.find(c => c.type === 'text')?.text ?? '' : userMessage.content;
    let { tools = {}, activeToolAlias = [] } = await validTools(context);

    let activeTools = activeToolAlias.map((t: string) => allTools[t]?.schema?.name || t) || [];
    // // if vertex use search grounding, do not use other tools
    if (model.provider.startsWith('google') && (context.SEARCH_GROUNDING || context.USE_GOOGLE_BUILDIN.length > 0)) {
        activeTools = [];
        tools = {};
        // only use first system message and last user message
        // params.messages = [params.messages.find(p => p.role === 'system')!, params.messages.findLast(p => p.role === 'user')!];
    }
    // only gemini-2 support google_buildin
    if (!model.modelId.startsWith('gemini-2')) {
        activeTools = activeTools.filter(t => t !== 'google_buildin');
    }

    let toolChoice;
    if (activeToolAlias.length > 0 && userText) {
        const choiceResult = await wrapToolChoice(activeToolAlias, userText);
        if (Array.isArray(userMessage.content)) {
            userMessage.content.find(c => c.type === 'text')!.text = choiceResult.message;
        } else {
            userMessage.content = choiceResult.message;
        }
        toolChoice = choiceResult.toolChoices;
    }

    log.info(`[warpLLMParams] activeTools: ${activeTools}`);

    return {
        model,
        messages,
        cache,
        tools,
        activeTools,
        toolChoice,
        context,
    };
}

export type ToolChoice = { type: 'auto' | 'none' | 'required' } | { type: 'tool'; toolName: string };

async function wrapToolChoice(activeToolAlias: string[], message: string): Promise<{
    message: string;
    toolChoices: ToolChoice[] | [];
}> {
    const tool_prefix = '/t-';
    const tools = await getTools();
    let text = message.trim();
    const choices = ['auto', 'none', 'required', ...activeToolAlias];
    const toolChoices = [];
    while (true) {
        const toolAlias = choices.find(t => text.startsWith(`${tool_prefix}${t}`)) || '';
        if (toolAlias) {
            text = text.substring(tool_prefix.length + toolAlias.length).trim();
            const choice = ['auto', 'none', 'required'].includes(toolAlias)
                ? { type: toolAlias as 'auto' | 'none' | 'required' }
                : { type: 'tool', toolName: tools[toolAlias].schema.name };
            toolChoices.push(choice);
        } else {
            break;
        }
    }

    log.info(`All RealtoolChoices: ${JSON.stringify(toolChoices)}`);

    return {
        message: text,
        toolChoices: toolChoices as ToolChoice[],
    };
}

function trimActiveTools(activeTools: string[], toolNames: string[]) {
    return activeTools.length > 0 ? activeTools.filter(name => !toolNames.includes(name)) : [];
}

function recordModelLog({ config, model, record }: { config: AgentUserConfig; model: LanguageModelV3; record: LogStruct }) {
    log.info(`provider: ${model.provider}, modelId: ${model.modelId} `);
    record.start_time = Date.now();
    record.model = model.modelId;
    if (config.ENABLE_ALIAS) {
        const mappedModel = config.MAPPING_VALUE.split('|').map(i => i.split(':')).find(([_, value]) => value === model.modelId);
        record.model = mappedModel?.[0] ?? model.modelId;
    }
}

export function metaDataExtractor(metadata: any, provider: string, content: string) {
    if (!metadata || !ENV.ENABLE_SEARCH_SOURCE) {
        return content;
    }

    switch (provider) {
        case 'google.generative-ai':
        case 'google.vertex.chat':
        {
            const { groundingChunks, webSearchQueries, groundingSupports } = metadata?.google?.groundingMetadata || {};
            if (!groundingChunks) {
                return content;
            }

            // const insertTextByByteIndex = (text: string, byteIndex: number, text2Insert: string) => {
            //     const encoder = new TextEncoder();
            //     const decoder = new TextDecoder();
            //     const bytes = encoder.encode(text);
            //     const newBytes = new Uint8Array([...bytes.slice(0, byteIndex), ...encoder.encode(text2Insert), ...bytes.slice(byteIndex)]);
            //     return decoder.decode(newBytes);
            // };

            const addSupportSource = (content: string) => {
                const sources = groundingChunks
                    ?.map((chunk: any, i: number) => {
                        const web = chunk?.web as { title?: string; uri?: string } | undefined;
                        return `[[${i + 1}\\]](${web?.uri ?? '#'})`;
                    })
                    .join('\x20');

                // const sortedGroundingSupports = (groundingSupports as any[]).sort((a, b) => b.segment.endIndex - a.segment.endIndex);
                for (const { segment, groundingChunkIndices } of groundingSupports) {
                    const tag = groundingChunkIndices?.map((i: number) => i + 1).join(', ');
                    // const tag = groundingChunkIndices?.map((i: number) => `[[${i + 1}\\]](${groundingChunks[i].web.uri})`).join('');
                    // content = insertTextByByteIndex(content, segment.endIndex, tag);
                    content = content.replace(segment.text, `$&[${tag}]`);
                }
                return `${content.trimEnd()}\n\n>sources:\n>${sources}`;
                // return `${content}\n## Sources:\n${sources}\n## Search Query:\n${webSearchQueries || ''}`;
                // return content;
            };

            return addSupportSource(content);
        }
        case 'oailike':
        {
            if ((metadata?.pplx?.citations ?? []).length > 0) {
                const replacer = (content: string, urls: string[]) => {
                    for (const [i, url] of Object.entries(urls)) {
                        content = content.replace(new RegExp(`\\[(${+i + 1})\\]`, 'g'), `[[$1\\]](${url})`);
                    }
                    return content;
                };
                return replacer(content, metadata?.pplx?.citations);
            }
            if ((metadata?.openai?.citations ?? []).length > 0) {
                const sources = metadata?.openai?.citations?.map(({ url_citation: { title, url } }: { url_citation: { title: string; url: string } }) => `- [${`${title.length > 40 ? `${title.slice(0, 40)}...` : title}`}](${url})`).join('\n>');
                return sources ? `${content.trimEnd()}\n\n>sources:\n>${sources}` : content;
            }
            return content;
        }
        default:
            return content;
    }
}

async function handleToolResult({ tools, toolResults, onStream, config }: { tools: Record<string, any>; toolResults: ToolResultPart[]; onStream: ChatStreamTextHandler | null; config: AgentUserConfig }) {
    const message_tool = Object.values(tools).filter(({ send_type }) => send_type === 'message').map(({ schema: { name } }) => name);
    const need_send_result: ToolResult[] = [];
    for (const { output, toolName } of toolResults) {
        if (message_tool.includes(toolName)) {
            need_send_result.push({ content: (output as any).value?.content ?? [] });
        }
    }
    if (need_send_result.length > 0) {
        const sender = onStream?.sender;
        const tool_names = toolResults.map(i => i.toolName).filter(i => message_tool.includes(i));
        log.info(`start send tool result: ${tool_names.join(', ')}`);
        // TODO: 非流式模式下，无法直接发送工具结果
        sender && await sendToolResult(need_send_result, sender, config);
        // Unable to modify the response message anymore due to:
        // https://github.com/vercel/ai/blob/42fcd32dd81e5071a864943dbdcd4be69a8cae8c/packages/ai/core/generate-text/generate-text.ts#L488
        toolResults.forEach(({ toolName, output }) => {
            if (message_tool.includes(toolName) && (output.type === 'text' || output.type === 'json')) {
                output.value = 'Data has been sent to user already.';
            }
        });
    }
}

function handleResponseApiMessage(messages: LanguageModelV3Prompt) {
    // Issue: When the message contains inference messages, tool calls and tool results do not contain ref_id.
    // https://github.com/vercel/ai/issues/7099
    // temporary fix: remove reasoning text
    for (const [i, message] of messages.entries()) {
        if (message.role === 'assistant' && Array.isArray(message.content)) {
            // 移除所有reasoning text
            message.content = message.content.filter(i => i.type !== 'reasoning');
            // 下一条消息不是tool时，移除 reasoning
            // const nextNotTool = messages[i + 1]?.role !== 'tool';
            // nextNotTool && (message.content = message.content.filter(i => i.type !== 'reasoning'));
        }
        // if (message.role === 'tool') {
        //     const prev = messages[i - 1];
        //     // 不是assistant 或者 不包含reasoning
        //     const occurErr = prev?.role !== 'assistant' || !Array.isArray(prev?.content) || !prev?.content.find(i => i.type === 'reasoning');
        //     if (occurErr) {
        //         throw new Error('Please clear history to avoid response api error.');
        //     }
        // }
    }
    return messages;
}
