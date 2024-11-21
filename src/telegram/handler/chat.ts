/* eslint-disable unused-imports/no-unused-vars */
import type { FilePart, TextPart, ToolResultPart } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { ChatStreamTextHandler, HistoryModifier, ImageResult, LLMChatRequestParams } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import type { ChosenInlineSender } from '../utils/send';
import type { UnionData } from '../utils/utils';
import type { MessageHandler } from './types';
import { loadAudioLLM, loadChatLLM, loadImageGen } from '../../agent';
import { loadHistory, requestCompletionsFromLLM } from '../../agent/chat';
import { ENV } from '../../config/env';
import { clearLog, getLog, logSingleton } from '../../log/logDecortor';
import { log } from '../../log/logger';
import { sendToolResult } from '../../tools';
import { imageToBase64String, renderBase64DataURI } from '../../utils/image';
import { createTelegramBotAPI } from '../api';
import { escape } from '../utils/md2tgmd';
import { MessageSender, sendAction, TelegraphSender } from '../utils/send';
import { waitUntil } from '../utils/utils';

async function messageInitialize(sender: MessageSender, streamSender: ChatStreamTextHandler): Promise<void> {
    if (!sender.context.message_id) {
        try {
            setTimeout(() => sendAction(sender.api.token, sender.context.chat_id, 'typing'), 0);
            log.info(`send init message`);
            streamSender.send('...', 'chat');
        } catch (e) {
            console.error('Failed to initialize message:', e);
        }
    }
}

export async function chatWithLLM(
    message: Telegram.Message,
    params: LLMChatRequestParams | null,
    context: WorkerContext,
    modifier: HistoryModifier | null,
): Promise<Response> {
    const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
    const streamSender = OnStreamHander(sender, context, message.text || '');
    messageInitialize(sender, streamSender);

    const agent = loadChatLLM(context.USER_CONFIG);
    if (!agent) {
        return streamSender.end?.('LLM is not enabled');
    }

    try {
        log.info(`start chat with LLM`);
        const answer = await requestCompletionsFromLLM(params, context, agent, modifier, ENV.STREAM_MODE ? streamSender : null);
        log.info(`chat with LLM done`);
        if (answer.messages.at(-1)?.role === 'tool') {
            const result = await sendToolResult(answer.messages.at(-1)?.content as ToolResultPart[], sender, context.USER_CONFIG);
            if (result instanceof Response) {
                return result;
            }
        }
        if (answer.content === '') {
            return streamSender.end?.('No response');
        }
        return streamSender.end?.(answer.content);
    } catch (e) {
        let errMsg = `Error: `;
        if ((e as Error).name === 'AbortError') {
            errMsg += 'Chat with LLM timeout';
        } else {
            errMsg += (e as Error).message.slice(0, 2048);
        }
        return streamSender.end?.(`\`\`\`\n${errMsg.replace(context.SHARE_CONTEXT.botToken, '[REDACTED]')}\n\`\`\``);
    }
}

export function findPhotoFileID(photos: Telegram.PhotoSize[], offset: number): string {
    let sizeIndex = offset >= 0 ? offset : photos.length + offset;
    sizeIndex = Math.max(0, Math.min(sizeIndex, photos.length - 1));
    return photos[sizeIndex].file_id;
}

export class ChatHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        try {
            log.info(`message type: ${context.MIDDEL_CONTEXT.originalMessageInfo.type}`);
            await this.initializeHistory(context);

            // 处理原始消息
            const params = await this.processOriginalMessage(message, context);
            // 执行工作流
            await workflow(context, message, params);
            return null;
        } catch (e) {
            console.error('Error:', e);
            const sender = context.MIDDEL_CONTEXT.sender ?? MessageSender.from(context.SHARE_CONTEXT.botToken, message);
            const filtered = (e as Error).message.replace(context.SHARE_CONTEXT.botToken, '[REDACTED]');
            return sender.sendRichText(`<pre>Error:${filtered.substring(0, 4000)}</pre>`, 'HTML');
        }
    };

    private async initializeHistory(context: WorkerContext): Promise<void> {
        // 初始化历史消息
        const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
        if (!historyKey) {
            throw new Error('History key not found');
        }
        context.MIDDEL_CONTEXT.history = await loadHistory(historyKey);
    }

    private async processOriginalMessage(
        message: Telegram.Message,
        context: WorkerContext,
    ): Promise<LLMChatRequestParams> {
        const { type, id } = context.MIDDEL_CONTEXT.originalMessageInfo;
        const params: LLMChatRequestParams = {
            role: 'user',
            content: message.text || message.caption || '',
        };

        if (type !== 'text' && id) {
            const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
            const files = await Promise.all(id.map(i => api.getFileWithReturns({ file_id: i })));
            const paths = files.map(f => f.result.file_path).filter(Boolean) as string[];
            const urls = paths.map(p => `https://api.telegram.org/file/bot${context.SHARE_CONTEXT.botToken}/${p}`);
            log.info(`File URLs:\n${urls.join('\n')}`);
            if (urls.length > 0) {
                params.content = [];
                if (message.text || message.caption) {
                    params.content.push({
                        type: 'text',
                        text: message.text || message.caption || '',
                    });
                }
                if (type === 'image' || type === 'photo') {
                    for (const url of urls) {
                        params.content.push({
                            type: 'image',
                            image: ENV.TELEGRAM_IMAGE_TRANSFER_MODE === 'url' ? url : renderBase64DataURI(await imageToBase64String(url)),
                        });
                    }
                } else if (type === 'audio' || type === 'voice') {
                    params.content.push({
                        type: 'file',
                        data: urls[0],
                        mimeType: 'audio/ogg',
                    });
                }
            }
        }

        return params;
    }
}

export function OnStreamHander(sender: MessageSender | ChosenInlineSender, context?: WorkerContext, question?: string): ChatStreamTextHandler {
    let sentPromise = null as Promise<Response> | null;
    let nextEnableTime: number | null = null;
    let sentError = false;
    const isMessageSender = sender instanceof MessageSender;
    const sendInterval = isMessageSender ? ENV.TELEGRAM_MIN_STREAM_INTERVAL : ENV.INLINE_QUERY_SEND_INTERVAL;
    const isSendTelegraph = (text: string) => {
        return isMessageSender
            ? ENV.TELEGRAPH_SCOPE.includes(sender.context.chatType) && ENV.TELEGRAPH_NUM_LIMIT > 0 && text.length > ENV.TELEGRAPH_NUM_LIMIT
            : sender.context.inline_message_id && text.length > 4096;
    };

    const streamSender = {
        send: null as ((text: string, isEnd: boolean, sendType?: 'chat' | 'telegraph') => Promise<any>) | null,
        end: null as ((text: string) => Promise<any>) | null,
    };
    streamSender.send = async (text: string): Promise<any> => {
        try {
            if (isSendTelegraph(text)) {
                return;
            }
            // 判断是否需要等待
            if ((nextEnableTime || 0) > Date.now()) {
                log.info(`Need await: ${(nextEnableTime || 0) - Date.now()}ms`);
                return;
            }

            await sentPromise;

            // 设置最小流间隔
            if (sendInterval > 0) {
                nextEnableTime = Date.now() + sendInterval;
            }

            const data = context ? `${getLog(context.USER_CONFIG)}\n${text}` : text;
            log.info(`sent message ids: ${isMessageSender ? [...sender.context.sentMessageIds] : sender.context.inline_message_id}`);
            isMessageSender && sendAction(sender.api.token, sender.context.chat_id, 'typing');
            sentPromise = sender.sendRichText(data, sentError ? undefined : ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode, 'chat');
            const resp = await sentPromise;
            // 判断429
            if (resp.status === 429) {
                // 获取重试时间
                const retryAfter = Number.parseInt(resp.headers.get('Retry-After') || '');
                if (retryAfter) {
                    nextEnableTime = Date.now() + retryAfter * 1000;
                    log.error(`Status 429, need wait: ${nextEnableTime - Date.now()}ms`);
                    return;
                }
            }

            if (!resp.ok) {
                log.error(`send message failed: ${resp.status} ${resp.statusText}`);
                sentError = true;
                log.error(`send message failed: ${escape(data.split('\n'))}`);
                return sentPromise = sender.sendPlainText(text);
            }
        } catch (e) {
            console.error(e);
        }
    };

    streamSender.end = async (text: string): Promise<any> => {
        log.info('--- start end ---');
        await sentPromise;
        await waitUntil((nextEnableTime || 0) + 10);
        if (isSendTelegraph(text)) {
            return sendTelegraph(context!, sender, question || 'Redo Question', text);
        }
        const data = context ? `${getLog(context.USER_CONFIG)}\n${text}` : text;
        log.info(`sent message ids: ${isMessageSender ? [...sender.context.sentMessageIds] : sender.context.inline_message_id}`);
        isMessageSender && sendAction(sender.api.token, sender.context.chat_id, 'typing');
        while (true) {
            const finalResp = await (sentError ? sender.sendPlainText(data) : sender.sendRichText(data));
            if (finalResp.status === 429) {
                const retryAfter = Number.parseInt(finalResp.headers.get('Retry-After') || '');
                if (retryAfter) {
                    log.error(`Status 429, need wait: ${retryAfter}s`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue;
                }
            }
            if (sentError || !finalResp.ok) {
                (sender as MessageSender).context.sentMessageIds.clear();
                return sendTelegraph(context!, sender, question || 'Redo Question', text, true);
            }
            return finalResp;
        }
    };

    return streamSender as unknown as ChatStreamTextHandler;
}

async function sendTelegraph(context: WorkerContext, sender: MessageSender | ChosenInlineSender, question: string, text: string, containRaw?: boolean) {
    log.info(`start send telegraph`);
    if (question.length > 600) {
        question = `${question.slice(0, 300)}...${question.slice(-300)}`;
    }
    const prefix = `#Question\n\`\`\`\n${question}\n\`\`\`\n---`;
    const botName = context.SHARE_CONTEXT?.botName || 'AI';

    log.info(logSingleton);
    log.info(getLog(context.USER_CONFIG));

    const telegraph_prefix = `${prefix}\n#Answer\n🤖 **${getLog(context.USER_CONFIG, true, false)}**\n`;
    const debug_info = `debug info:\n${getLog(context.USER_CONFIG, false, false) as string}`;
    const telegraph_suffix = `\n---\n\`\`\`\n${debug_info}\n\`\`\``;
    const telegraphSender = new TelegraphSender(botName, context.SHARE_CONTEXT.telegraphAccessTokenKey!);
    const resp = await telegraphSender.send(
        'Daily Q&A',
        telegraph_prefix + text + telegraph_suffix,
        containRaw ? text : undefined,
    );
    const url = `https://telegra.ph/${telegraphSender.teleph_path}`;
    const msg = `${containRaw ? '由于渲染出现错误 ' : ''}回答已经转换成完整文章。\n[🔗点击进行查看](${url})`.trim();
    log.info(`send telegraph message: ${msg}`);
    return sender.sendRichText(msg);
}

type WorkflowHandler = (
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext
) => Promise<Response | void>;

function workflowHandlers(type: string): WorkflowHandler {
    switch (type) {
        case 'text:text':
        case 'image:text':
        case 'photo:text':
            return handleTextToText;
        case 'text:image':
            return handleTextToImage;
        case 'voice:text':
        case 'audio:text':
            return handleAudioToText;
        default:
            throw new Error(`Unsupported message type: ${type}`);
    }
}

async function workflow(
    context: WorkerContext,
    message: Telegram.Message,
    params: LLMChatRequestParams,
): Promise<Response | void> {
    const msgType = context.MIDDEL_CONTEXT.originalMessageInfo.type;
    const handlerKey = `${msgType}:text`;
    const handler = workflowHandlers(handlerKey);
    return handler(message, params, context);
}

async function handleTextToText(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
): Promise<Response> {
    return chatWithLLM(message, params, context, null);
}

async function handleTextToImage(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
): Promise<Response> {
    const agent = loadImageGen(context.USER_CONFIG);
    const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
    if (!agent) {
        return sender.sendPlainText('ERROR: Image generator not found');
    }
    sendAction(context.SHARE_CONTEXT.botToken, message.chat.id);
    await sender.sendPlainText('Please wait a moment...', 'tip').then(r => r.json());
    const result = await agent.request(message.text || message.caption || '', context.USER_CONFIG);
    log.info('imageresult', JSON.stringify(result));
    await sendImages(result, ENV.SEND_IMAGE_AS_FILE, sender, context.USER_CONFIG);
    const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
    return api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
}

async function handleAudioToText(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
): Promise<Response> {
    const agent = loadAudioLLM(context.USER_CONFIG);
    const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
    if (!agent) {
        return sender.sendPlainText('ERROR: Audio agent not found');
    }
    const url = (params.content as FilePart[]).at(-1)?.data as string;
    const audio = await fetch(url).then(b => b.blob());
    const result = await agent.request(audio, context.USER_CONFIG);
    context.MIDDEL_CONTEXT.history.push({ role: 'user', content: result.text || '' });
    await sender.sendRichText(`${getLog(context.USER_CONFIG, false, false)}\n> \n${result.text}`, 'MarkdownV2', 'chat');
    if (ENV.AUDIO_HANDLE_TYPE === 'chat' && result.text) {
        clearLog(context.USER_CONFIG);
        const otherText = (params.content as TextPart[]).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
        return chatWithLLM(message, { role: 'user', content: `[AUDIO]: ${result.text}\n${otherText}` }, context, null);
    }
    return new Response('audio handle done');
}

export async function sendImages(img: ImageResult, SEND_IMAGE_AS_FILE: boolean, sender: MessageSender, config: AgentUserConfig) {
    const caption = img.text ? `${getLog(config)}\n> ${img.text}` : getLog(config);
    if (img.url && img.url.length > 1) {
        const images = img.url.map((url: string) => ({
            type: (SEND_IMAGE_AS_FILE ? 'document' : 'photo'),
            media: url,
        })) as Telegram.InputMedia[];
        images.at(-1)!.caption = escape(caption.split('\n'));
        images.at(-1)!.parse_mode = ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode;
        return await sender.sendMediaGroup(images);
    } else if (img.url && img.url.length === 1) {
        return sender.editMessageMedia({
            type: 'photo',
            media: img.url[0],
        }, caption, ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode);
    } else if (img.url || img.raw) {
        return sender.sendPhoto((img.url || img.raw)![0], caption, 'MarkdownV2');
    } else {
        return sender.sendPlainText('ERROR: No image found');
    }
}

function injectHistory(context: WorkerContext, result: UnionData, nextType: string = 'text') {
    if (context.MIDDEL_CONTEXT.history.at(-1)?.role === 'user' || nextType !== 'text')
        return;
    context.MIDDEL_CONTEXT.history.push({ role: 'user', content: result.text || '', ...(result.url && result.url.length > 0 && { images: result.url }) });
}
