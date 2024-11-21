import type * as Telegram from 'telegram-bot-api-types';
import type { CallbackQueryContext, ChosenInlineWorkerContext, InlineQueryContext, WorkerContextBase } from '../../config/context';
import type { TelegramBotAPI } from '../api';
import type { InlineItem } from '../command/types';
import type { UnionData } from '../utils/utils';
import type { CallbackQueryHandler, ChosenInlineQueryHandler, InlineQueryHandler, MessageHandler } from './types';
import { WorkerContext } from '../../config/context';
import { ENV } from '../../config/env';
import { tagMessageIds } from '../../log/logDecortor';
import { log } from '../../log/logger';
import { Rerank } from '../../utils/data_calculation/rerank';
import { createTelegramBotAPI } from '../api';
import { handleCommandMessage } from '../command';
import { loadChatRoleWithContext } from '../command/auth';
import { COMMAND_AUTH_CHECKER, InlineCommandHandler } from '../command/system';
import { escape } from '../utils/md2tgmd';
import { MessageSender } from '../utils/send';
import { chunckArray, extractMessageInfo, isTelegramChatTypeGroup } from '../utils/utils';
import { AnswerChatInlineQuery } from './query';

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
                return sender.sendPlainText(text);
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
        context.MIDDEL_CONTEXT.originalMessageInfo = messageInfo;
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
        Object.assign(context, { USER_CONFIG: (await WorkerContext.from(context.SHARE_CONTEXT, context.MIDDEL_CONTEXT)).USER_CONFIG });
        return null;
    };
}

export class StoreHistory implements MessageHandler<WorkerContext> {
    handle = async (message: Telegram.Message, context: WorkerContext): Promise<Response | null> => {
        const historyDisable = ENV.AUTO_TRIM_HISTORY && ENV.MAX_HISTORY_LENGTH <= 0;
        if (!historyDisable) {
            const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
            const history = context.MIDDEL_CONTEXT.history;
            const userMessage = history.findLast(h => h.role === 'user');
            if (ENV.HISTORY_IMAGE_PLACEHOLDER && Array.isArray(userMessage?.content) && userMessage.content.length > 0) {
                userMessage.content = userMessage.content.map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('\n');
            }
            await ENV.DATABASE.put(historyKey, JSON.stringify(history)).catch(console.error);
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

export class HandlerCallbackQuery implements CallbackQueryHandler<CallbackQueryContext> {
    handle = async (message: Telegram.Message, context: CallbackQueryContext): Promise<Response | null> => {
        if (!context.data) {
            return new Response('success', { status: 200 });
        }
        const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
        const checkRoleResult = await this.checkWhiteList(message, context, api);
        if (checkRoleResult instanceof Response) {
            return checkRoleResult;
        }
        if (context.data === 'CLOSE') {
            return this.closeInlineKeyboard(api, message);
        }
        const queryHandler = new InlineCommandHandler();
        const defaultInlineKeys = queryHandler.defaultInlineKeys(context.USER_CONFIG);

        const [inlineKey, option] = context.data.split('.');
        await this.checkInlineKey(api, context, inlineKey, option, defaultInlineKeys);

        let inlineKeyboard: Telegram.InlineKeyboardButton[][] = [];

        if (inlineKey === 'BACK') {
            inlineKeyboard = queryHandler.inlineKeyboard(context.USER_CONFIG, defaultInlineKeys);
        } else {
            const configKey = defaultInlineKeys[inlineKey].config_key;
            const optionValue = defaultInlineKeys[inlineKey].available_values?.[Number.parseInt(option)];

            if (optionValue) {
                await this.updateConfig(context, api, configKey, optionValue);
            }

            let configValue = context.USER_CONFIG[configKey];
            if (typeof configValue === 'boolean') {
                configValue = configValue ? 'true' : 'false';
            }
            inlineKeyboard = this.updateInlineList(defaultInlineKeys[inlineKey], configValue);
        }
        const settingMessage = queryHandler.settingsMessage(context.USER_CONFIG, queryHandler.defaultInlineKeys(context.USER_CONFIG));

        return this.sendCallBackMessage(api, message, settingMessage, inlineKeyboard);
    };

    private async checkInlineKey(api: TelegramBotAPI, context: CallbackQueryContext, key: string, index: string, inlineKeys: Record<string, any>) {
        if (key === 'BACK') {
            return;
        }
        if ((index && inlineKeys[key]?.available_values?.[index]) || (!index && inlineKeys[key])) {
            return;
        }
        this.sendAlert(api, context.query_id, 'Not support inline key', false);
        throw new Error('Not support inline key');
    }

    private async sendAlert(api: TelegramBotAPI, query_id: string, text: string, show_alert?: boolean, cache_time?: number) {
        return api.answerCallbackQuery({
            callback_query_id: query_id,
            text,
            show_alert,
            cache_time,
        });
    }

    private async checkWhiteList(message: Telegram.Message, context: CallbackQueryContext, api: TelegramBotAPI) {
        const roleList = COMMAND_AUTH_CHECKER.shareModeGroup(message.chat.type);
        if (roleList) {
            // 获取身份并判断
            const chatRole = await loadChatRoleWithContext(message, context, true);
            if (chatRole === null) {
                return this.sendAlert(api, context.query_id, '⚠️ Get chat role failed', false);
            }
            if (!roleList.includes(chatRole)) {
                return this.sendAlert(api, context.query_id, `⚠️ You don't have permission to operate`, true);
            }
        }
        return null;
    }

    private async updateConfig(context: CallbackQueryContext, api: TelegramBotAPI, configKey: string, newValue: string) {
        const oldValue = context.USER_CONFIG[configKey];
        const type = Array.isArray(oldValue) ? 'array' : typeof oldValue;
        switch (type) {
            case 'string':
            case 'boolean':
                if (oldValue === newValue) {
                    return;
                } else {
                    context.USER_CONFIG[configKey] = newValue;
                }
                break;
            case 'array':
                if (oldValue.includes(newValue)) {
                    oldValue.splice(oldValue.indexOf(newValue), 1);
                } else {
                    oldValue.push(newValue);
                }
                break;
            default:
                throw new TypeError('Not support config type');
        }

        if (!context.USER_CONFIG.DEFINE_KEYS.includes(configKey)) {
            context.USER_CONFIG.DEFINE_KEYS.push(configKey);
        }
        log.info(`[CALLBACK QUERY] Update config: ${configKey} = ${context.USER_CONFIG[configKey]}`);
        await ENV.DATABASE.put(context.SHARE_CONTEXT.configStoreKey, JSON.stringify(context.USER_CONFIG)).catch(console.error);
        this.sendAlert(api, context.query_id, '✅ Data update successful', false);
    }

    private async closeInlineKeyboard(api: TelegramBotAPI, message: Telegram.Message) {
        return api.deleteMessage({
            chat_id: message.chat.id,
            message_id: message.message_id,
        }).then(r => r.json());
    }

    private async sendCallBackMessage(api: TelegramBotAPI, message: Telegram.Message, text: string, inline_keyboard: Telegram.InlineKeyboardButton[][]) {
        return api.editMessageText({
            chat_id: message.chat.id,
            message_id: message.message_id,
            ...(message.chat.type === 'private' ? {} : { reply_to_message_id: message.message_id }),
            text: escape(text.split('\n')),
            parse_mode: 'MarkdownV2',
            reply_markup: { inline_keyboard },
        });
    }

    private updateInlineList(inline_item: InlineItem, configValue: string | boolean) {
        const inline_list = inline_item.available_values.map((item: string | boolean, index: number) => {
            let selected = '';
            if ((configValue && item === configValue) || (Array.isArray(configValue) && configValue?.includes(item))) {
                selected = '✅';
            }
            return {
                text: `${selected}${item}`,
                callback_data: `${inline_item.data}.${index}`,
            };
        });

        inline_list.push({
            text: '↩️',
            callback_data: 'BACK',
        }, {
            text: '❌',
            callback_data: 'CLOSE',
        });
        return chunckArray(inline_list, 2);
    };
}

export class HandlerInlineQuery implements InlineQueryHandler<InlineQueryContext> {
    handle = async (chosenInline: Telegram.InlineQuery, context: InlineQueryContext): Promise<Response | null> => {
        const endSuffix = '$';
        if (!chosenInline.query.endsWith(endSuffix)) {
            log.info(`[INLINE QUERY] Not end with $: ${chosenInline.query}`);
            return new Response('success', { status: 200 });
        }
        const api = createTelegramBotAPI(context.token);
        const resp = await api.answerInlineQuery({
            inline_query_id: context.query_id,
            results: [{
                type: 'article',
                id: ':c stream',
                title: 'Stream Mode',
                input_message_content: {
                    message_text: `Please wait a moment`,
                },
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: 'Thinking...',
                            callback_data: ':c stream',
                        }],
                    ],
                },
            }, {
                type: 'article',
                id: ':c full',
                title: 'Full Mode',
                input_message_content: {
                    message_text: `Please wait a moment`,
                },
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: 'Thinking...',
                            callback_data: ':c full',
                        }],
                    ],
                },
            }],
        }).then(r => r.json());
        log.info(`[INLINE QUERY] Answer inline query: ${JSON.stringify(resp)}`);
        return new Response('success', { status: 200 });
    };
}

export class CheckInlineQueryWhiteList implements InlineQueryHandler<InlineQueryContext> {
    handle = async (inlineQuery: Telegram.InlineQuery, context: InlineQueryContext): Promise<Response | null> => {
        if (ENV.CHAT_WHITE_LIST.includes(`${context.from_id}`)) {
            return null;
        }
        log.error(`User ${context.from_id} not in the white list`);
        return new Response(`User ${context.from_id} not in the white list`, { status: 403 });
    };
}

export class AnswerInlineQuery implements ChosenInlineQueryHandler<ChosenInlineWorkerContext> {
    handle = async (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext): Promise<Response | null> => {
        const answer = new AnswerChatInlineQuery();
        return answer.handler(chosenInline, context);
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
        const text = (message.text || message.caption || '').trim().match(regex);
        if (text && text[1] && text[2]) {
            const rerank = new Rerank();
            try {
                const similarityModel = (await rerank.rank(context.USER_CONFIG, [text[2], ...context.USER_CONFIG.RERANK_MODELS], 1))[0].name;
                const mode = text[1];
                const textReplace = `/set ${mode === 'c' ? '-CHAT_MODEL' : `-VISION_MODEL`} ${similarityModel} `;
                if (message.text) {
                    message.text = textReplace + message.text.slice(text[0].length).trim();
                } else if (message.caption) {
                    message.caption = textReplace + message.caption.slice(text[0].length).trim();
                }
            } catch (error) {
                log.error(`[INTELLIGENT MODEL PROCESS] Rerank error: ${error}`);
                return null;
            }
        }
        return null;
    };
}
