import type * as Telegram from 'telegram-bot-api-types';
import type { ShareContext, WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import { ENV } from '../../config/env';
import { ConfigMerger } from '../../config/merger';

export class CallbackQueryContext {
    data: string;
    query_id: string;
    from: Telegram.User;
    USER_CONFIG: AgentUserConfig;
    SHARE_CONTEXT: ShareContext;

    constructor(callbackQuery: Telegram.CallbackQuery, workContext: WorkerContext) {
        this.data = callbackQuery.data!;
        this.query_id = callbackQuery.id;
        this.from = callbackQuery.from!;
        this.USER_CONFIG = workContext.USER_CONFIG;
        this.SHARE_CONTEXT = workContext.SHARE_CONTEXT;
    }
}

export class InlineQueryContext {
    token: string;
    query_id: string;
    from: Telegram.User;
    chat_type: string | undefined;
    query: string;

    constructor(token: string, inlineQuery: Telegram.InlineQuery) {
        this.token = token;
        this.query_id = inlineQuery.id;
        this.from = inlineQuery.from;
        this.chat_type = inlineQuery.chat_type;
        this.query = inlineQuery.query;
    }
}

export class ChosenInlineContext {
    token: string;
    from_id: number;
    query: string;
    result_id: string;
    inline_message_id: string;
    constructor(token: string, choosenInlineQuery: Telegram.ChosenInlineResult) {
        this.token = token;
        this.from_id = choosenInlineQuery.from.id;
        this.query = choosenInlineQuery.query;
        this.result_id = choosenInlineQuery.result_id;
        this.inline_message_id = choosenInlineQuery.inline_message_id || '';
    }
}

export class ChosenInlineWorkerContext {
    USER_CONFIG: AgentUserConfig;
    botToken: string;
    MIDDLE_CONTEXT: Record<string, any>;
    SHARE_CONTEXT: Record<string, any>;
    constructor(chosenInline: Telegram.ChosenInlineResult, token: string, USER_CONFIG: AgentUserConfig) {
        this.USER_CONFIG = USER_CONFIG;
        this.botToken = token;
        // 模拟私聊消息
        this.MIDDLE_CONTEXT = {
            originalMessageInfo: { type: 'text' },
        };
        this.SHARE_CONTEXT = {
            botName: 'AI',
            telegraphAccessTokenKey: `telegraph_access_token:${chosenInline.from.id}`,
        };
    }

    static async from(token: string, chosenInline: Telegram.ChosenInlineResult): Promise<ChosenInlineWorkerContext> {
        const USER_CONFIG = { ...ENV.USER_CONFIG };
        // Same as private chat
        let userConfigKey = `user_config:${chosenInline.from.id}`;
        const botId = Number.parseInt(token.split(':')[0]);
        if (botId) {
            userConfigKey += `:${botId}`;
        }
        try {
            const userConfig: AgentUserConfig = JSON.parse(await ENV.DATABASE.get(userConfigKey));
            ConfigMerger.merge(USER_CONFIG, ConfigMerger.trim(userConfig, ENV.LOCK_USER_CONFIG_KEYS) || {});
            USER_CONFIG.ENABLE_SHOWINFO = ENV.INLINE_QUERY_SHOW_INFO;
            // 过于频繁的请求不会被Telegram接受
            ENV.TELEGRAM_MIN_STREAM_INTERVAL = ENV.INLINE_QUERY_SEND_INTERVAL;
        } catch (e) {
            console.warn(e);
        }
        return new ChosenInlineWorkerContext(chosenInline, token, USER_CONFIG);
    }
}
