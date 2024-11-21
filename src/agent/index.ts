/* eslint-disable no-case-declarations */
import type { CoreMessage, CoreUserMessage, LanguageModelV1 } from 'ai';
import type { AudioAgent, ChatAgent, ImageAgent } from './types';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { type AgentUserConfig, ENV } from '../config/env';
import { log } from '../log/logger';
import { isCfWorker } from '../telegram/utils/utils';
import { tools, vaildTools } from '../tools';
import { Anthropic } from './anthropic';
import { AzureChatAI, AzureImageAI } from './azure';
import { Cohere } from './cohere';
import { Google } from './google';

import { Mistral } from './mistralai';
import { Dalle, OpenAI, Transcription } from './openai';
import { OpenAILike, OpenAILikeImage } from './openailike';
import { Vertex } from './vertex';
import { WorkersChat, WorkersImage } from './workersai';

export const CHAT_AGENTS: ChatAgent[] = [
    new Anthropic(),
    new AzureChatAI(),
    new Cohere(),
    new Google(),
    new Mistral(),
    new OpenAI(),
    new WorkersChat(),
    new OpenAILike(),
    new Vertex(),
];

export function loadChatLLM(context: AgentUserConfig): ChatAgent | null {
    // let CHAT_AGENTS = CHAT_AGENTS_ITER();
    for (const llm of CHAT_AGENTS) {
        if (llm.name === context.AI_PROVIDER) {
            return llm;
        }
    }
    // 找不到指定的AI，使用第一个可用的AI
    // CHAT_AGENTS = CHAT_AGENTS_ITER();
    for (const llm of CHAT_AGENTS) {
        if (llm.enable(context)) {
            return llm;
        }
    }
    return null;
}

export const IMAGE_AGENTS: ImageAgent[] = [
    new AzureImageAI(),
    new Dalle(),
    new WorkersImage(),
    new OpenAILikeImage(),
];

export function loadImageGen(context: AgentUserConfig): ImageAgent | null {
    for (const imgGen of IMAGE_AGENTS) {
        if (imgGen.name === context.AI_IMAGE_PROVIDER) {
            return imgGen;
        }
    }
    // 找不到指定的AI，使用第一个可用的AI
    for (const imgGen of IMAGE_AGENTS) {
        if (imgGen.enable(context)) {
            return imgGen;
        }
    }
    return null;
}

const AUDIO_AGENTS: AudioAgent[] = [
    // 当前仅实现OpenAI音频处理
    new Transcription(),
];

export function loadAudioLLM(context: AgentUserConfig) {
    for (const llm of AUDIO_AGENTS) {
        if (llm.name === context.AI_PROVIDER) {
            return llm;
        }
    }
    // 找不到指定的AI，使用第一个可用的AI
    for (const llm of AUDIO_AGENTS) {
        if (llm.enable(context)) {
            return llm;
        }
    }
    return null;
}

/**
 * 提取模型等信息
 * @param {UserConfigType} config
 * @return {string} info
 */
export function customInfo(config: AgentUserConfig): string {
    const prompt = config.SYSTEM_INIT_MESSAGE || '';
    const other_info = {
        mode: config.CURRENT_MODE,
        prompt: prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt,
        MAPPING_KEY: config.MAPPING_KEY,
        MAPPING_VALUE: config.MAPPING_VALUE,
        USE_TOOLS: config.USE_TOOLS.join(','),
        SUPPORT_PLUGINS: [...Object.keys(ENV.PLUGINS_FUNCTION), ...Object.keys(tools)].join('|'),
        CHAT_TRIGGER_PERFIX: ENV.CHAT_TRIGGER_PERFIX,
        MESSAGE_REPLACER: Object.keys(ENV.MESSAGE_REPLACER).join('|'),
        MAX_STEPS: config.MAX_STEPS,
        MAX_RETRIES: config.MAX_RETRIES,
        SEND_IMAGE_AS_FILE: ENV.SEND_IMAGE_AS_FILE,
        SUPPORT_PROMPT_ROLE: Object.keys(config.PROMPT).join('|'),
        DISABLE_WEB_PREVIEW: ENV.DISABLE_WEB_PREVIEW,
        VERTEX_SEARCH_GROUNDING: config.VERTEX_SEARCH_GROUNDING,
    };
    return JSON.stringify(other_info, null, 2);
}

export async function warpLLMParams(params: { messages: CoreMessage[]; model: LanguageModelV1 }, context: AgentUserConfig) {
    const tool_envs: Record<string, any> = { ...(context.JINA_API_KEY && { JINA_API_KEY: context.JINA_API_KEY[Math.floor(Math.random() * context.JINA_API_KEY.length)] }) };

    const env_perfix = 'TOOL_ENV_';
    Object.keys(context).forEach(i => i.startsWith(env_perfix) && (tool_envs[i.substring(env_perfix.length - 1)] = context[i]));

    const messages = params.messages.at(-1) as CoreUserMessage;
    let tool = typeof messages.content === 'string'
        ? await vaildTools(context.USE_TOOLS)
        : undefined;

    let activeTools = tool?.activeToolAlias.map(t => tools[t].schema.name);
    // if vertex use search grounding, do not use other tools
    if (params.model.provider === 'google-vertex' && context.VERTEX_SEARCH_GROUNDING) {
        activeTools = undefined;
        tool = undefined;
        // only use first system message and last user message
        params.messages = [params.messages.find(p => p.role === 'system')!, params.messages.findLast(p => p.role === 'user')!];
    }

    let toolChoice;
    if (tool?.activeToolAlias && tool?.activeToolAlias.length > 0) {
        const userMessageIsString = typeof messages.content === 'string';
        const choiceResult = wrapToolChoice(tool?.activeToolAlias, userMessageIsString ? messages.content as string : '');
        userMessageIsString && (messages.content = choiceResult.message);
        toolChoice = choiceResult.toolChoices;
    }

    log.info(`[warpLLMParams] activeTools: ${activeTools}`);

    return {
        model: params.model,
        messages: params.messages,
        tools: tool?.tools,
        activeTools,
        toolChoice,
        context,
    };
}

export async function createLlmModel(model: string, context: AgentUserConfig) {
    let [agent, model_id] = model.includes(':') ? model.trim().split(':') : [context.AI_PROVIDER, model];
    if (agent === 'auto') {
        throw new Error('Auto mode is not supported, please specify the agent');
    }
    if (!model_id) {
        model_id = context[`${agent.toUpperCase()}_CHAT_MODEL`];
    }
    switch (agent) {
        case 'openai':
        case 'gpt':
            return createOpenAI({
                baseURL: context.OPENAI_API_BASE,
                apiKey: context.OPENAI_API_KEY[Math.floor(Math.random() * context.OPENAI_API_KEY.length)],
                compatibility: 'strict',
            }).languageModel(model_id, undefined);
        case 'claude':
        case 'anthropic':
            return createAnthropic({
                baseURL: context.ANTHROPIC_API_BASE,
                apiKey: context.ANTHROPIC_API_KEY || undefined,
            }).languageModel(model_id, undefined);
        case 'google':
        case 'gemini':
            return createGoogleGenerativeAI({
                baseURL: context.GOOGLE_API_BASE,
                apiKey: context.GOOGLE_API_KEY || undefined,
            }).languageModel(model_id, {
                safetySettings: [
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                ],
            });
        case 'cohere':
            return createCohere({
                baseURL: context.COHERE_API_BASE,
                apiKey: context.COHERE_API_KEY || undefined,
            }).languageModel(model_id, undefined);
        case 'vertex':
            if (isCfWorker)
                throw new Error('Vertex is not supported in Cloudflare Workers');
            const { createVertex } = await import('@ai-sdk/google-vertex');
            return createVertex({
                project: context.VERTEX_PROJECT_ID!,
                location: context.VERTEX_LOCATION,
                googleAuthOptions: {
                    credentials: context.VERTEX_CREDENTIALS,
                },
            }).languageModel(model_id, {
                safetySettings: [
                    { category: 'HARM_CATEGORY_UNSPECIFIED', threshold: 'BLOCK_NONE' },
                ],
                useSearchGrounding: context.VERTEX_SEARCH_GROUNDING,
            });
        default:
            return createOpenAI({
                name: 'olike',
                baseURL: context.OPENAILIKE_API_BASE || undefined,
                apiKey: context.OPENAILIKE_API_KEY || undefined,
            }).languageModel(model_id, undefined);
    }
    // if (model.includes(':')) {
    //     if (model.startsWith('google:') || model.startsWith('vertex:')) {
    //         // registry返回为完整实例，无法添加额外设置，此处直接注入 safetySettings
    //         let modelInstance = (await registryFactory(context)).languageModel(model);
    //         modelInstance = {
    //             ...modelInstance,
    //             settings: {
    //                 safetySettings: [
    //                     { category: 'HARM_CATEGORY_UNSPECIFIED', threshold: 'BLOCK_NONE' },
    //                     { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    //                     { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    //                     { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    //                     { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    //                 ],
    //             },
    //         } as LanguageModelV1;
    //         return modelInstance;
    //     }
    //     return (await registryFactory(context)).languageModel(model);
    // }
}

// async function registryFactory(context: AgentUserConfig) {
//     const providers = {
//         openai: createOpenAI({
//             baseURL: context.OPENAI_API_BASE,
//             apiKey: context.OPENAI_API_KEY[Math.floor(Math.random() * context.OPENAI_API_KEY.length)],
//         }),
//         claude: createAnthropic({
//             baseURL: context.ANTHROPIC_API_BASE,
//             apiKey: context.ANTHROPIC_API_KEY || undefined,
//         }),
//         google: createGoogleGenerativeAI({
//             baseURL: context.GOOGLE_API_BASE,
//             apiKey: context.GOOGLE_API_KEY || undefined,
//         }),
//         cohere: createCohere({
//             baseURL: context.COHERE_API_BASE,
//             apiKey: context.COHERE_API_KEY || undefined,
//         }),
//         azure: createAzure({
//             baseURL: context.AZURE_OPENAI_API_BASE,
//             apiKey: context.AZURE_OPENAI_API_KEY || undefined,
//         }),
//         xai: createOpenAI({
//             baseURL: context.XAI_API_BASE,
//             apiKey: context.XAI_API_KEY || undefined,
//         }),
//         silicon: createOpenAI({
//             baseURL: context.SILICON_API_BASE,
//             apiKey: context.SILICON_API_KEY || undefined,
//         }),
//     } as Record<string, Provider>;
//     if (!isCfWorker) {
//         const { createVertex } = await import('@ai-sdk/google-vertex');
//         providers.vertex = createVertex({
//             project: context.VERTEX_PROJECT_ID!,
//             location: context.VERTEX_LOCATION,
//             googleAuthOptions: {
//                 credentials: context.VERTEX_CREDENTIALS,
//             },
//         });
//     }
//     return createProviderRegistry(providers);
// }

export type ToolChoice = { type: 'auto' | 'none' | 'required' } | { type: 'tool'; toolName: string };

function wrapToolChoice(activeToolAlias: string[], message: string): {
    message: string;
    toolChoices: ToolChoice[] | [];
} {
    const tool_perfix = '/t-';
    let text = message.trim();
    const choices = ['auto', 'none', 'required', ...activeToolAlias];
    const toolChoices = [];
    while (true) {
        const toolAlias = choices.find(t => text.startsWith(`${tool_perfix}${t}`)) || '';
        if (toolAlias) {
            text = text.substring(tool_perfix.length + toolAlias.length).trim();
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
