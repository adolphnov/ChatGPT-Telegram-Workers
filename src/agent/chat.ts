import type { WorkerContext } from '../config/context';
import type { ChatAgent, ChatStreamTextHandler, HistoryItem, HistoryModifier, ImageResult, LLMChatParams, LLMChatRequestParams, ResponseMessage } from './types';
import { ENV } from '../config/env';

export async function loadHistory(key: string): Promise<HistoryItem[]> {
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

    const trimHistory = (list: HistoryItem[], initLength: number, maxLength: number) => {
        // 历史记录超出长度需要裁剪, 小于0不裁剪
        if (maxLength >= 0 && list.length > maxLength) {
            list = list.splice(list.length - maxLength);
        }
        return list;
    };

    // 裁剪
    if (ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH > 0) {
        history = trimHistory(history, 0, ENV.MAX_HISTORY_LENGTH);
        // 裁剪开始的tool call 以避免报错
        let validStart = 0;
        for (const h of history) {
            if (h.role === 'tool') {
                validStart++;
                continue;
            }
            break;
        }
        history = history.slice(validStart);
    }

    return history;
}

export async function requestCompletionsFromLLM(params: LLMChatRequestParams | null, context: WorkerContext, agent: ChatAgent, modifier: HistoryModifier | null, onStream: ChatStreamTextHandler | null): Promise<{ messages: ResponseMessage[]; content: string }> {
    let history = context.MIDDEL_CONTEXT.history;
    const historyDisable = ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH <= 0;
    // const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
    if (modifier) {
        const modifierData = modifier(history, params);
        history = modifierData.history;
        params = modifierData.message;
    }
    if (params === null) {
        throw new Error('Message is null');
    }
    const messages = [...history, params];
    if (context.USER_CONFIG.SYSTEM_INIT_MESSAGE) {
        messages.unshift({
            role: 'system',
            content: context.USER_CONFIG.SYSTEM_INIT_MESSAGE,
        });
    }
    const llmParams: LLMChatParams = {
        messages,
    };
    const answer = await agent.request(llmParams, context.USER_CONFIG, onStream);
    const { messages: raw_messages } = answer;

    if (!historyDisable) {
        // only push valid chat history
        if (raw_messages.at(-1)?.role === 'assistant') {
            history.push(params);
            history.push(...raw_messages);
        }
    }
    return answer;
}

export async function requestText2Image(url: string, headers: Record<string, any>, body: any, render: (arg: Response) => Promise<ImageResult>) {
    console.log('start generate image.');
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    const result = await render(resp);
    if (result.message) {
        throw new Error(result.message);
    }
    return result;
}
