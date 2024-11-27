/* eslint-disable unused-imports/no-unused-vars */
import type { FilePart, TextPart, ToolResultPart } from 'ai';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type * as Telegram from 'telegram-bot-api-types';
import type { ChatStreamTextHandler, HistoryModifier, ImageResult, LLMChatRequestParams } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import type { ChosenInlineSender } from '../utils/send';
import type { UnionData } from '../utils/utils';
import type { MessageHandler } from './types';
import { loadAudioLLM, loadChatLLM, loadImageGen } from '../../agent';
import { loadHistory, requestCompletionsFromLLM } from '../../agent/chat';
import { ASR } from '../../agent/openai';
import { ENV } from '../../config/env';
import { clearLog, getLog, logSingleton } from '../../log/logDecortor';
import { log } from '../../log/logger';
import { sendToolResult } from '../../tools';
import { imageToBase64String } from '../../utils/image';
import { OggToMp3Converter } from '../../utils/others/audio';
import { createTelegramBotAPI } from '../api';
import { escape } from '../utils/md2tgmd';
import { MessageSender, sendAction, TelegraphSender } from '../utils/send';
import { waitUntil } from '../utils/utils';

async function messageInitialize(sender: MessageSender, context?: WorkerContext, message?: Telegram.Message): Promise<ChatStreamTextHandler> {
    setTimeout(() => sendAction(sender.api.token, sender.context.chat_id, 'typing'), 0);
    log.info(`send init message`);
    const streamSender = OnStreamHander(sender, context, message?.text || message?.caption || '');
    streamSender.send('...');
    return streamSender;
}

export async function chatWithLLM(
    message: Telegram.Message,
    params: LLMChatRequestParams | null,
    context: WorkerContext,
    modifier: HistoryModifier | null,
    sender?: ChatStreamTextHandler,
    isMiddle?: boolean,
): Promise<Response | string> {
    const agent = loadChatLLM(context.USER_CONFIG);
    const streamSender = sender ?? OnStreamHander(MessageSender.from(context.SHARE_CONTEXT.botToken, message), context, message?.text || message?.caption || '');
    if (!agent) {
        return streamSender.end?.('LLM is not enabled');
    }

    try {
        log.info(`start chat with LLM`);
        const answer = await requestCompletionsFromLLM(params, context, agent, modifier, ENV.STREAM_MODE && !isMiddle ? streamSender : null);
        log.info(`chat with LLM done`);
        if (answer.messages.at(-1)?.role === 'tool') {
            const result = await sendToolResult(answer.messages.at(-1)?.content as ToolResultPart[], streamSender.sender!, context.USER_CONFIG);
            if (result instanceof Response) {
                return result;
            }
        }
        if (answer.content === '') {
            return streamSender.end?.('No response');
        }
        if (isMiddle) {
            return answer.content;
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
            log.info(`message type: ${context.MIDDLE_CONTEXT.originalMessageInfo.type}`);
            await this.initializeHistory(context);

            // 处理原始消息
            const params = await this.processOriginalMessage(message, context);
            // 执行工作流
            await workflow(context, message, params);
            return null;
        } catch (e) {
            log.error((e as Error).stack);
            const sender = context.MIDDLE_CONTEXT.sender ?? MessageSender.from(context.SHARE_CONTEXT.botToken, message);
            const filtered = (e as Error).message.replace(context.SHARE_CONTEXT.botToken, '[REDACTED]');
            return sender.sendRichText(`<pre>Error: ${filtered.substring(0, 2000)}</pre>`, 'HTML');
        }
    };

    private async initializeHistory(context: WorkerContext): Promise<void> {
        // 初始化历史消息
        const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
        if (!historyKey) {
            throw new Error('History key not found');
        }
        context.MIDDLE_CONTEXT.history = await loadHistory(historyKey);
    }

    private async processOriginalMessage(
        message: Telegram.Message,
        context: WorkerContext,
    ): Promise<LLMChatRequestParams> {
        const { type, id } = context.MIDDLE_CONTEXT.originalMessageInfo;
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
                    const isUrl = ENV.TELEGRAM_IMAGE_TRANSFER_MODE === 'url';
                    for (const url of urls) {
                        const { data, format } = isUrl ? { data: url, format: 'image/jpeg' } : await imageToBase64String(url);
                        params.content.push({
                            type: 'image',
                            image: data,
                            mimeType: format,
                        });
                    }
                } else if (type === 'audio' || type === 'voice') {
                    const isChat = context.USER_CONFIG.AUDIO_HANDLE_TYPE === 'chat';
                    let audioData = urls[0];
                    if (isChat) {
                        const response = await fetch(urls[0]);
                        if (!response.body) {
                            throw new Error('Failed to fetch audio data');
                        }
                        audioData = await new OggToMp3Converter(response.body as WebReadableStream, 'base64').convert() as string;
                    }
                    params.content.push({
                        type: 'file',
                        data: audioData,
                        mimeType: 'audio/mpeg',
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
        send: null as ((text: string, isEnd: boolean) => Promise<any>) | null,
        end: null as ((text: string) => Promise<any>) | null,
        sender,
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
                log.error(`send message failed: ${resp.status} ${await resp.json().then(j => j.description)}`);
                sentError = true;
                log.error(`send message failed: ${escape(data.split('\n'))}`);
                return sentPromise = sender.sendPlainText(text);
            }
        } catch (e) {
            log.error((e as Error).stack);
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
                log.error(`send message failed: ${finalResp.status} ${await finalResp.json().then(j => j.description)}`);
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
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
) => Promise<Response | Blob | string>;

function workflowHandlers(type: string): WorkflowHandler {
    switch (type) {
        case 'text:text':
        case 'text:audio':
        case 'asr:text':
        case 'asr:audio':
        case 'image:text':
        case 'photo:text':
        case 'text:chat':
        case 'chat:text':
        case 'chat:audio':
            return handleText;
        case 'text:image':
            return handleTextToImage;
        case 'audio:text':
        case 'audio:audio':
        case 'trans:text':
        case 'trans:audio':
            return handleAudio;
        default:
            throw new Error(`Unsupported message type: ${type}`);
    }
}

async function workflow(
    context: WorkerContext,
    message: Telegram.Message,
    params: LLMChatRequestParams,
): Promise<Response | Blob | string> {
    const msgType = context.MIDDLE_CONTEXT.originalMessageInfo.type;
    let handlerKey = `${msgType}:`;
    if (msgType === 'text') {
        handlerKey = `${context.USER_CONFIG.TEXT_HANDLE_TYPE}:${context.USER_CONFIG.TEXT_OUTPUT}`;
    } else if (msgType === 'audio' || msgType === 'voice') {
        handlerKey = `${context.USER_CONFIG.AUDIO_HANDLE_TYPE}:${context.USER_CONFIG.AUDIO_OUTPUT}`;
    } else {
        handlerKey += 'text';
    }
    const handler = workflowHandlers(handlerKey);
    const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
    const streamSender = await messageInitialize(sender, context, message);
    return handler(message, params, context, streamSender, handlerKey);
}

async function handleText(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response | string> {
    switch (handleKey) {
        case 'asr:audio':
        case 'asr:text':
        case 'text:audio':
            return handleTextToAudio(message, params, context, streamSender, handleKey);
        default:
            return chatWithLLM(message, params, context, null, streamSender);
    }
}

async function handleTextToImage(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response> {
    const agent = loadImageGen(context.USER_CONFIG);
    const sender = streamSender.sender!;
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

async function handleAudio(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response | string> {
    const url = (params.content as FilePart[]).at(-1)?.data as string;
    const audio = await fetch(url).then(b => b.blob());
    const text = await transcription(audio, context.USER_CONFIG);
    context.MIDDLE_CONTEXT.history.push({ role: 'user', content: text });
    const sender = streamSender.sender!;
    if (handleKey === 'audio:text' || !ENV.HIDE_MIDDLE_MESSAGE) {
        await sender.sendRichText(`${getLog(context.USER_CONFIG, false, false)}\n> \n${text}`);
    }
    if (handleKey === 'trans:text') {
        return new Response('audio handle done');
    }
    clearLog(context.USER_CONFIG);
    !ENV.HIDE_MIDDLE_MESSAGE && sender.context.sentMessageIds.clear();
    const isMiddle = handleKey === 'audio:audio';
    const otherText = (params.content as TextPart[]).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const resp = await chatWithLLM(message, { role: 'user', content: `[AUDIO TRANSCRIPTION]: ${text}\n${otherText}` }, context, null, streamSender, isMiddle);
    if (isMiddle) {
        const voice = await asr(resp as string, context.USER_CONFIG);
        ENV.HIDE_MIDDLE_MESSAGE && sender.api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
        sendAction(context.SHARE_CONTEXT.botToken, sender.context.chat_id, 'upload_voice');
        return sender.sendVoice(voice);
    }
    return resp;
}

async function handleTextToAudio(
    message: Telegram.Message,
    params: LLMChatRequestParams,
    context: WorkerContext,
    streamSender: ChatStreamTextHandler,
    handleKey: string,
): Promise<Response> {
    let text = params.content as string;
    const sender = streamSender.sender!;
    if (handleKey === 'text:audio') {
        !ENV.HIDE_MIDDLE_MESSAGE && streamSender.send('Chat with LLM in progress');
        text = await chatWithLLM(message, params, context, null, streamSender, true) as string;
        !ENV.HIDE_MIDDLE_MESSAGE && streamSender.send('Chat with LLM done');
    }
    const audio = await asr(text, context.USER_CONFIG);
    sendAction(context.SHARE_CONTEXT.botToken, sender.context.chat_id, 'upload_voice');
    const resp = await sender.sendVoice(audio, context.USER_CONFIG.AUDIO_CONTAINS_TEXT ? text : undefined);
    if (resp.ok) {
        return sender.api.deleteMessage({ chat_id: sender.context.chat_id, message_id: sender.context.message_id! });
    }
    // log.error(`Failed to send voice message: ${resp.status} ${await resp.text()}`);
    throw new Error(`Failed to send voice message: ${resp.status} ${await resp.json().then(j => j.description)}`);
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
            caption,
        }, ENV.DEFAULT_PARSE_MODE as Telegram.ParseMode);
    } else if (img.url || img.raw) {
        return sender.sendPhoto((img.url || img.raw)![0], caption, 'MarkdownV2');
    } else {
        return sender.sendPlainText('ERROR: No image found');
    }
}

function injectHistory(context: WorkerContext, result: UnionData, nextType: string = 'text') {
    if (context.MIDDLE_CONTEXT.history.at(-1)?.role === 'user' || nextType !== 'text')
        return;
    context.MIDDLE_CONTEXT.history.push({ role: 'user', content: result.text || '', ...(result.url && result.url.length > 0 && { images: result.url }) });
}

function transcription(audio: Blob, config: AgentUserConfig) {
    const agent = loadAudioLLM(config);
    if (!agent) {
        throw new Error('Audio agent not found');
    }
    return agent.request(audio, config);
}

function asr(text: string, config: AgentUserConfig) {
    const agent = new ASR();
    return agent.hander(text, config);
}
