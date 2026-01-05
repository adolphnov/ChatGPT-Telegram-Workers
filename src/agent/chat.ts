/* eslint-disable unused-imports/no-unused-vars */
import type { ModelMessage } from 'ai';
import type { WorkerContext } from '../config/context';
import type { AgentUserConfig } from '../config/env';
import type { ChatAgent, ChatStreamTextHandler, HistoryItem, HistoryModifier, LLMChatParams, LLMChatRequestParams, ResponseMessage } from './types';
import { loadChatLLM } from '.';
import { ENV } from '../config/env';
import { log } from '../log/logger';

export async function loadHistory(key: string, length: number): Promise<HistoryItem[]> {
    // 加载历史记录
    let history = [];
    try {
        history = JSON.parse(await ENV.DATABASE.get(key));
    } catch (e) {
        console.error(e);
    }
    if (!history || !Array.isArray(history)) {
        history = [];
    }

    const trimHistory = (list: HistoryItem[], maxLength: number) => {
        // 历史记录超出长度需要裁剪, 小于0不裁剪
        if (maxLength >= 0 && list.length > maxLength) {
            list = list.splice(list.length - maxLength);
        }
        return list;
    };

    // 裁剪
    if (ENV.AUTO_TRIM_HISTORY) {
        history = trimHistory(history, length);
        // 裁剪开始的tool result 以避免报错
        // let validStart = 0;
        // for (const h of history) {
        //     if (h.role === 'tool') {
        //         validStart++;
        //         continue;
        //     }
        //     break;
        // }
        // history = history.slice(validStart);
    }

    return history;
}

export async function requestCompletionsFromLLM(params: LLMChatRequestParams | null, context: WorkerContext, agent: ChatAgent, modifier: HistoryModifier | null, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> {
    let history = context.MIDDLE_CONTEXT.history;
    const historyDisable = ENV.STORE_HISTORY_LENGTH <= 0;
    if (modifier) {
        const modifierData = modifier(history, params);
        history = modifierData.history;
        params = modifierData.message;
    }
    if (params === null) {
        throw new Error('Message is null');
    }

    const trimer = (list: HistoryItem[], maxLength: number) => {
        // 裁剪超出上下文长度的历史消息
        if (list.length > 0 && list.length > maxLength) {
            list = list.slice(list.length - maxLength);
        }

        // 裁剪开始的tool result 以避免报错
        let validStart = 0;
        for (const h of list) {
            if (h.role === 'tool') {
                validStart++;
                continue;
            }
            break;
        }
        return list.slice(validStart);
    };
    const messages = [...trimer(history, context.USER_CONFIG.MAX_HISTORY_LENGTH), params];
    const llmParams: LLMChatParams = {
        messages: injectSystemMessage(messages, context.USER_CONFIG.SYSTEM_INIT_MESSAGE),
        cache: [],
    };
    const answer = await workflow(agent, llmParams, context.USER_CONFIG, onStream);
    const { messages: raw_messages } = answer;

    if (!historyDisable && raw_messages.at(-1)?.role === 'assistant') {
        // only push valid chat history
        history.push(params);
        // last message cannot be tool-call
        let validEnd = raw_messages.length;
        for (const m of raw_messages) {
            if (m.role === 'assistant' && Array.isArray(m.content)) {
                // ai 5.0.0-beta.9 contain too many empty reasoning content
                m.content = m.content.filter((i) => {
                    if (i.type === 'reasoning')
                        return i.text !== '';
                    return true;
                });
            }
        }
        // When the last message is tool call message, delete it.
        for (const m of raw_messages.toReversed()) {
            if (m.role === 'assistant' && Array.isArray(m.content) && m.content.find(i => i.type === 'tool-call')) {
                validEnd--;
                continue;
            }
            break;
        }
        history.push(...raw_messages.slice(0, validEnd));
        await storeHistory(history, context);
    }
    return answer;
}

export async function storeHistory(history: ModelMessage[], context: WorkerContext) {
    const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
    const userMessage = history.findLast(h => h.role === 'user');
    if (ENV.HISTORY_IMAGE_PLACEHOLDER && Array.isArray(userMessage?.content) && userMessage.content.length > 0) {
        userMessage.content = userMessage.content.map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
    }
    await ENV.DATABASE.put(historyKey, JSON.stringify(history)).catch(console.error);
    log.info(`[STORE HISTORY] DONE`);
}

async function workflow(agent: ChatAgent, llmParams: LLMChatParams, context: AgentUserConfig, onStream: ChatStreamTextHandler | null) {
    const question = llmParams.messages.at(-1)?.content;
    if (!context.ENABLE_WORKFLOW || typeof question !== 'string') {
        return agent.request(llmParams, context, onStream);
    }

    const key = Object.keys(context.WORKFLOW).find(key => question.startsWith(`@${key}`));
    if (!key) {
        return agent.request(llmParams, context, onStream);
    }

    llmParams.messages.at(-1)!.content = question.substring(key.length + 1).trimStart();
    const backup = { ...context };
    const updater = (context: AgentUserConfig, { agent, model, temperature, max_tokens }: { agent: string; model: string; temperature: number; max_tokens: number; next: string }) => {
        agent && (context.AI_CHAT_PROVIDER = agent);
        model && (context[`${agent.toUpperCase()}_CHAT_MODEL`] = model);
        temperature && (context.CHAT_TEMPERATURE = temperature);
        max_tokens && (context.MAX_TOKENS = max_tokens);
    };
    const renderNext = (result: string, { next }: { next: string }) => {
        llmParams.messages.pop();
        llmParams.messages.push({
            role: 'user',
            content: next.replace('{{question}}', question).replace('{{result}}', result) || `question: ${question}\nresult: ${result}`,
        });
    };

    for (const workflow of context.WORKFLOW[key]) {
        updater(context, workflow);
        const agent = loadChatLLM(context);
        if (!agent) {
            throw new Error(`Agent ${workflow.agent} not found`);
        }
        const result = await agent.request(llmParams, context, onStream);
        // 不发送给ai的消息
        if (result.messages.at(-1)?.role === 'tool') {
            return result;
        }
        // const text = extractResultText(result, llmParams);
        const stepText = result.content.slice(llmParams.cache?.join().length || 0);
        if (stepText.trim() === '') {
            throw new Error('Response is empty');
        }
        llmParams.cache!.push(`${stepText}\n▲\n`);
        await onStream?.send(result.content);
        renderNext(stepText, workflow);
    }
    Object.assign(context, backup);
    return agent.request(llmParams, context, onStream);
}

function extractResultText(result: { messages: ResponseMessage[]; content: string }, llmParams: LLMChatParams) {
    const lastMessage = result.messages.at(-1)!;
    if (Array.isArray(lastMessage.content)) {
        return lastMessage.content.map(c => ['text', 'reasoning'].includes(c.type) ? (c as any).text || '' : '').join('\n')
            || result.content.slice(llmParams.cache?.join().length || 0);
    }
    return lastMessage.content;
};

export function injectSystemMessage(messages: ModelMessage[], systemMessage: string | null) {
    if (systemMessage) {
        // 注入{{CURRENT_TIME}}
        systemMessage = systemMessage.replace('{{CURRENT_TIME}}', new Date().toISOString());
        messages.unshift({
            role: 'system',
            content: systemMessage,
        });
    }
    return messages;
}
