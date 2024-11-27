import type { CoreMessage } from 'ai';
import type { ChosenInlineResult, Message } from 'telegram-bot-api-types';
import type * as Telegram from 'telegram-bot-api-types';
import type { WorkerContext } from '../../config/context';
import type { TelegramBotAPI } from '../api';
import type { InlineItem } from '../command/types';
import type { MessageHandler } from '../handler/types';
import type { MessageSender } from '../utils/send';
import type { CallbackQueryHandler, ChosenInlineQueryHandler, InlineQueryHandler } from './types';
import { OpenAI } from '../../agent/openai';
import { WorkerContextBase } from '../../config/context';
import { ENV } from '../../config/env';
import { log } from '../../log/logger';
import { createTelegramBotAPI } from '../api';
import { loadChatRoleWithContext } from '../command/auth';
import { COMMAND_AUTH_CHECKER, InlineCommandHandler, SetCommandHandler } from '../command/system';
import { catchError } from '../handler';
import { OnStreamHander } from '../handler/chat';
import { SubstituteWords } from '../handler/group';
import { EnvChecker, InitUserConfig, WhiteListFilter } from '../handler/handlers';
import { escape } from '../utils/md2tgmd';
import { ChosenInlineSender } from '../utils/send';
import { chunckArray } from '../utils/utils';
import { CallbackQueryContext, ChosenInlineWorkerContext, InlineQueryContext } from './context';

interface answerInlineQuery {
    type: string;
    handler: (chosenInline: ChosenInlineResult, context: ChosenInlineWorkerContext) => Promise<Response>;
    handlerQuestion: (chosenInline: ChosenInlineResult, context: ChosenInlineWorkerContext, sender: MessageSender) => Promise<string>;
}

export class AnswerChatInlineQuery implements answerInlineQuery {
    type = ':c';
    handler = async (chosenInline: ChosenInlineResult, context: ChosenInlineWorkerContext): Promise<Response> => {
        const sender = ChosenInlineSender.from(context.botToken, chosenInline);
        const question = await this.handlerQuestion(chosenInline, context, sender as unknown as MessageSender);
        if (!question) {
            return new Response('ok');
        }
        const agent = new OpenAI();
        const isStream = chosenInline.result_id === ':c stream';
        const OnStream = OnStreamHander(sender as unknown as MessageSender, context as unknown as WorkerContext, question);
        const messages = [{ role: 'user', content: question }];
        if (context.USER_CONFIG.SYSTEM_INIT_MESSAGE) {
            messages.unshift({ role: 'system', content: context.USER_CONFIG.SYSTEM_INIT_MESSAGE });
        }
        try {
            const resp = await agent.request({
                messages: messages as CoreMessage[],
            }, context.USER_CONFIG, isStream ? OnStream : null);
            const { content: answer } = resp;
            if (answer === '') {
                return OnStream.end?.('No response');
            }
            return OnStream.end?.(answer);
        } catch (e) {
            const filtered = (e as Error).message.replace(context.botToken, '[REDACTED]');
            return OnStream.end?.(`Error: ${filtered.substring(0, 2000)}`);
        }
    };

    handlerQuestion = async (chosenInline: ChosenInlineResult, context: ChosenInlineWorkerContext, sender: MessageSender): Promise<string> => {
        const question = chosenInline.query.substring(0, chosenInline.query.length - 1).trim();
        // simulate message and substitute words
        const message = { text: question } as unknown as Message;
        SubstituteWords(message);
        if (message.text?.startsWith('/set ')) {
            const resp = await new SetCommandHandler().handle(message, message.text.substring(5).trim(), context as unknown as WorkerContext, sender);
            if (resp instanceof Response) {
                return '';
            }
        }

        return message.text || '';
    };
}

// class AnswerImageInlineQuery implements answerInlineQuery {
//     type = ':i';
//     handler = async (context: InlineQueryContext, query: string): Promise<Response> => {
//         return new Response('ok');
//     };
// }

// class AnswerSpeechInlineQuery implements answerInlineQuery {
//     type = ':s';
//     handler = async (context: InlineQueryContext, query: string): Promise<Response> => {
//         return new Response('ok');
//     };
// }

export async function handleCallbackQuery(token: string, callbackQuery: Telegram.CallbackQuery) {
    try {
        log.info('handleCallbackQuery');
        if (!callbackQuery?.message || !callbackQuery?.data) {
            throw new Error('Not support callback query type');
        }

        const workContext = new WorkerContextBase(token, callbackQuery.message);

        const handlers: MessageHandler<any>[] = [
            new EnvChecker(),
            new WhiteListFilter(),
            new InitUserConfig(),
        ];
        for (const handler of handlers) {
            const result = await handler.handle(callbackQuery.message, workContext);
            if (result instanceof Response) {
                return result;
            }
        }

        const callbackQueryContext = new CallbackQueryContext(callbackQuery, workContext as WorkerContext);
        const result = await new HandlerCallbackQuery().handle(callbackQuery.message, callbackQueryContext);
        if (result instanceof Response) {
            return result;
        }
    } catch (e) {
        return catchError(e as Error);
    }
    return null;
}

export async function handleInlineQuery(token: string, inlineQuery: Telegram.InlineQuery) {
    log.info(`handleInlineQuery`, inlineQuery);
    try {
        const context = new InlineQueryContext(token, inlineQuery);
        const handlers: InlineQueryHandler<InlineQueryContext>[] = [
            new CheckInlineQueryWhiteList(),
            new HandlerInlineQuery(),
        ];
        for (const handler of handlers) {
            const result = await handler.handle(inlineQuery, context);
            if (result instanceof Response) {
                return result;
            }
        }
    } catch (error) {
        return catchError(error as Error);
    }
    return null;
}

export async function handleChosenInline(token: string, chosenInlineQuery: Telegram.ChosenInlineResult) {
    log.info(`handleChosenInlineQuery`, chosenInlineQuery);
    try {
        const context = await ChosenInlineWorkerContext.from(token, chosenInlineQuery);
        const handlers: ChosenInlineQueryHandler<ChosenInlineWorkerContext>[] = [
            new AnswerInlineQuery(),
        ];
        for (const handler of handlers) {
            const result = await handler.handle(chosenInlineQuery, context);
            if (result instanceof Response) {
                return result;
            }
        }
    } catch (error) {
        return catchError(error as Error);
    }
    return null;
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
        if (ENV.CHAT_WHITE_LIST.includes(`${context.from.id}`)) {
            return null;
        }
        const roleList = COMMAND_AUTH_CHECKER.shareModeGroup(message.chat.type);
        if (roleList) {
            // 获取身份并判断
            const chatRole = await loadChatRoleWithContext(message, context, true);
            if (chatRole === null) {
                return this.sendAlert(api, context.query_id, '⚠️ Get chat role failed', false);
            }
            if (!roleList.includes(chatRole)) {
                log.error(`[CALLBACK QUERY] User ${context.from.first_name}, id: ${context.from.id} not in the white list`);
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
        if (ENV.CHAT_WHITE_LIST.includes(`${context.from.id}`)) {
            return null;
        }
        log.error(`User ${context.from.username}, id: ${context.from.id} not in the white list`);
        return new Response(`User ${context.from.id} not in the white list`, { status: 403 });
    };
}

export class AnswerInlineQuery implements ChosenInlineQueryHandler<ChosenInlineWorkerContext> {
    handle = async (chosenInline: Telegram.ChosenInlineResult, context: ChosenInlineWorkerContext): Promise<Response | null> => {
        const answer = new AnswerChatInlineQuery();
        return answer.handler(chosenInline, context);
    };
}
