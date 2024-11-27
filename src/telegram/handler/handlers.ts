import type * as Telegram from 'telegram-bot-api-types';
import type { WorkerContextBase } from '../../config/context';
import type { UnionData } from '../utils/utils';
import type { MessageHandler } from './types';
import { WorkerContext } from '../../config/context';
import { ENV } from '../../config/env';
import { tagMessageIds } from '../../log/logDecortor';
import { log } from '../../log/logger';
import { Rerank } from '../../utils/data_calculation/rerank';
import { createTelegramBotAPI } from '../api';
import { handleCommandMessage } from '../command';
import { MessageSender } from '../utils/send';
import { extractMessageInfo, isTelegramChatTypeGroup } from '../utils/utils';

export class SaveLastMessage implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (!ENV.DEBUG_MODE) {
            return null;
        }
        const lastMessageKey = `last_message:${context.SHARE_CONTEXT.chatHistoryKey}`;
        await ENV.DATABASE.put(lastMessageKey, JSON.stringify(message));
        return null;
    };
}

export class OldMessageFilter implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (!ENV.SAFE_MODE || context.SHARE_CONTEXT.isForwarding) {
            return null;
        }
        let idList = [];
        try {
            idList = JSON.parse(await ENV.DATABASE.get(context.SHARE_CONTEXT.lastMessageKey).catch(() => '[]')) || [];
        } catch (e) {
            console.error(e);
        }
        // 保存最近的100条消息，如果存在则忽略，如果不存在则保存
        if (idList.includes(message.message_id)) {
            throw new Error('Ignore old message');
        } else {
            idList.push(message.message_id);
            if (idList.length > 100) {
                idList.shift();
            }
            await ENV.DATABASE.put(context.SHARE_CONTEXT.lastMessageKey, JSON.stringify(idList));
        }
        return null;
    };
}

export class EnvChecker implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (!ENV.DATABASE) {
            return MessageSender
                .from(context.SHARE_CONTEXT.botToken, message)
                .sendPlainText('DATABASE Not Set');
        }
        return null;
    };
}

export class WhiteListFilter implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        if (ENV.I_AM_A_GENEROUS_PERSON) {
            return null;
        }
        const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const text = `You are not in the white list, please contact the administrator to add you to the white list. Your chat_id: ${message.chat.id}`;

        // 判断私聊消息
        if (message.chat.type === 'private') {
            // 白名单判断
            if (!ENV.CHAT_WHITE_LIST.includes(`${message.chat.id}`)) {
                // return sender.sendPlainText(text);
                log.error(`[WHITE LIST] ${message.chat.id} not in white list`);
                return new Response('success', { status: 200 });
            }
            return null;
        }

        // 判断群组消息
        if (isTelegramChatTypeGroup(message.chat.type)) {
            // 未打开群组机器人开关,直接忽略
            if (!ENV.GROUP_CHAT_BOT_ENABLE) {
                throw new Error('Not support');
            }
            // 白名单判断
            if (!ENV.CHAT_GROUP_WHITE_LIST.includes(`${message.chat.id}`)) {
                return sender.sendPlainText(text);
            }
            return null;
        }

        return sender.sendPlainText(
            `Not support chat type: ${message.chat.type}`,
        );
    };
}

export class MessageFilter implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        const messageInfo = extractMessageInfo(message, context.SHARE_CONTEXT.botId);
        const supportMessageType = ENV.ENABLE_FILE ? ['text', 'photo', 'voice', 'audio', 'image'] : ['text'];
        if (!supportMessageType.includes(messageInfo.type)) {
            throw new Error('Not supported message type');
        };
        context.MIDDLE_CONTEXT.originalMessageInfo = messageInfo;
        if (ENV.IGNORE_TEXT_PERFIX && (message.text || message.caption || '').startsWith(ENV.IGNORE_TEXT_PERFIX)) {
            log.info(`[IGNORE MESSAGE] Ignore message`);
            return new Response('success', { status: 200 });
        }
        return null;
    };
}

export class CommandHandler implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | UnionData | null> => {
        if (message.text || message.caption) {
            return await handleCommandMessage(message, context);
        }
        // 非文本消息不作处理
        return null;
    };
}

export class InitUserConfig implements MessageHandler<WorkerContextBase> {
    handle = async (message: Telegram.Message, context: WorkerContextBase): Promise<Response | null> => {
        Object.assign(context, { USER_CONFIG: (await WorkerContext.from(context.SHARE_CONTEXT, context.MIDDLE_CONTEXT)).USER_CONFIG });
        return null;
    };
}

export class StoreHistory implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const historyDisable = ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH <= 0;
        const isAsr = context.USER_CONFIG.TEXT_HANDLE_TYPE === 'asr';
        const isTrans = context.USER_CONFIG.AUDIO_HANDLE_TYPE === 'trans';
        if (!historyDisable && (!isAsr || !isTrans)) {
            const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
            const history = context.MIDDLE_CONTEXT.history;
            const userMessage = history.findLast(h => h.role === 'user');
            if (ENV.HISTORY_IMAGE_PLACEHOLDER && Array.isArray(userMessage?.content) && userMessage.content.length > 0) {
                userMessage.content = userMessage.content.map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
            }
            await ENV.DATABASE.put(historyKey, JSON.stringify(history)).catch(console.error);
            log.info(`[STORE HISTORY] DONE`);
        }
        return null;
    };
}

export class TagNeedDelete implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        // 未记录消息
        if ((tagMessageIds.get(message) ?? new Set()).size === 0) {
            log.info(`[TAG MESSAGE] No message id to tag`);
            return null;
        }
        const botName = context.SHARE_CONTEXT?.botName;
        if (!botName) {
            throw new Error('未检索到Bot Name, 无法设定定时删除.');
        }

        const chatId = message.chat.id;
        const scheduleDeteleKey = context.SHARE_CONTEXT.scheduleDeteleKey;
        const scheduledData = JSON.parse((await ENV.DATABASE.get(scheduleDeteleKey)) || '{}');
        if (!scheduledData[botName]) {
            scheduledData[botName] = {};
        }
        if (!scheduledData[botName][chatId]) {
            scheduledData[botName][chatId] = [];
        }
        const offsetInMillisenconds = ENV.EXPIRED_TIME * 60 * 1000;
        scheduledData[botName][chatId].push({
            id: [...(tagMessageIds.get(message) || [])],
            ttl: Date.now() + offsetInMillisenconds,
        });

        await ENV.DATABASE.put(scheduleDeteleKey, JSON.stringify(scheduledData));
        log.info(`[TAG MESSAGE] Record chat ${chatId}, message ids: ${[...(tagMessageIds.get(message) || [])]}`);
        return null;
    };
}

export class CheckForwarding implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        if (ENV.QSTASH_PUBLISH_URL && ENV.QSTASH_TOKEN && ENV.QSTASH_TRIGGER_PREFIX && !context.SHARE_CONTEXT.isForwarding) {
            let text = (message.text || message.caption || '').trim();
            if (text.startsWith(ENV.QSTASH_TRIGGER_PREFIX)) {
                text = text.slice(ENV.QSTASH_TRIGGER_PREFIX.length);
                if (message.text) {
                    message.text = text;
                } else {
                    message.caption = text;
                }
                const QSTASH_REQUEST_URL = `${ENV.QSTASH_URL}/v2/publish/${ENV.QSTASH_PUBLISH_URL}/telegram/${context.SHARE_CONTEXT.botToken}/webhook`;
                log.info(`[FORWARD] Forward message to Qstash`);
                const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
                await sender.sendRichText('`Forwarding message to Qstash`', 'MarkdownV2', 'tip');
                return await fetch(QSTASH_REQUEST_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ENV.QSTASH_TOKEN}`,
                        'Upstash-Timeout': `${ENV.QSTASH_TIMEOUT}`,
                        // no retry
                        'Upstash-Retries': '0',
                    },
                    body: JSON.stringify({
                        message,
                    }),
                });
            }
        }
        return null;
    };
}

export class IntelligentModelProcess implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        if (!context.USER_CONFIG.ENABLE_INTELLIGENT_MODEL) {
            return null;
        }
        const regex = /^\s*\/\/(c|v)\s*(\S+)/;
        const text = new RegExp(regex).exec((message.text || message.caption || '').trim());
        if (text?.[1] && text[2]) {
            const rerank = new Rerank();
            const sendTipPromise = this.sendTip(context, message);
            try {
                const similarityModel = (await rerank.rank(context.USER_CONFIG, [text[2], ...context.USER_CONFIG.RERANK_MODELS], 1))[0].name;
                const mode = text[1];
                const textReplace = `/set ${mode === 'c' ? '-CHAT_MODEL' : `-VISION_MODEL`} ${similarityModel} `;
                if (message.text) {
                    message.text = textReplace + message.text.slice(text[0].length).trim();
                } else if (message.caption) {
                    message.caption = textReplace + message.caption.slice(text[0].length).trim();
                }
                this.deleteTip(context, (await sendTipPromise).result);
            } catch (error) {
                log.error(`[INTELLIGENT MODEL PROCESS] Rerank error: ${error}`);
                return null;
            }
        }
        return null;
    };

    sendTip = (context: WorkerContext, message: Telegram.Message) => {
        const sendeParams: Telegram.SendMessageParams = {
            chat_id: message.chat.id,
            text: 'Searching for similarity result',
            message_thread_id: message.is_topic_message && message.message_thread_id ? message.message_thread_id : undefined,
        };
        return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessageWithReturns(sendeParams);
    };

    deleteTip = (context: WorkerContext, message: Telegram.Message) => {
        const delParams: Telegram.DeleteMessageParams = {
            message_id: message.message_id,
            chat_id: message.chat.id,
        };
        log.info('delete similarity tip.');
        return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).deleteMessage(delParams);
    };
}
