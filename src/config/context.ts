import type * as Telegram from 'telegram-bot-api-types';
import type { HistoryItem } from '../agent/types';
import type { MessageSender } from '../telegram/utils/send';
import type { UnionData } from '../telegram/utils/utils';
import type { AgentUserConfig } from './env';
import { ENV } from './env';
import { ConfigMerger } from './merger';

export class ShareContext {
    botId: number;
    botToken: string;
    botName: string | null = null;

    // KV 保存的键
    chatHistoryKey: string;
    lastMessageKey: string;
    configStoreKey: string;
    groupAdminsKey?: string;
    telegraphAccessTokenKey?: string;
    readonly scheduleDeteleKey: string = 'schedule_detele_message';
    storeMediaMessageKey?: string;
    chunkMessageKey?: string;
    // mediaMessageLock?: string;
    // chunkMessageLock?: string;
    isForwarding: boolean = false;

    constructor(token: string, message: Telegram.Message) {
        const botId = Number.parseInt(token.split(':')[0]);

        const telegramIndex = ENV.TELEGRAM_AVAILABLE_TOKENS.indexOf(token);
        if (telegramIndex === -1) {
            throw new Error('Token not allowed');
        }
        if (ENV.TELEGRAM_BOT_NAME.length > telegramIndex) {
            this.botName = ENV.TELEGRAM_BOT_NAME[telegramIndex];
        }

        this.botToken = token;
        this.botId = botId;
        const id = message?.chat?.id;
        if (id === undefined || id === null) {
            throw new Error('Chat id not found');
        }
        // message_id每次都在变的。
        // 私聊消息中：
        //   message.chat.id 是发言人id
        // 群组消息中：
        //   message.chat.id 是群id
        //   message.from.id 是发言人id
        // 没有开启群组共享模式时，要加上发言人id
        //  chatHistoryKey = history:chat_id:bot_id:(from_id)
        //  configStoreKey =  user_config:chat_id:bot_id:(from_id)
        //  storeMediaMessageKey = store_media_message:chat_id:(from_id)
        //  chunkMessageKey = chunk_message:chat_id:(from_id)

        let historyKey = `history:${id}`;
        let configStoreKey = `user_config:${id}`;
        let chunkMessageKey = ENV.STORE_TEXT_CHUNK_MESSAGE ? `chunk_message:${id}` : undefined;
        let storeMediaMessageKey = ENV.STORE_MEDIA_MESSAGE ? `store_media_message:${id}` : undefined;

        if (botId) {
            historyKey += `:${botId}`;
            configStoreKey += `:${botId}`;
        }
        // 标记群组消息
        switch (message.chat.type) {
            case 'group':
            case 'supergroup':
                if (!ENV.GROUP_CHAT_BOT_SHARE_MODE && message.from?.id) {
                    historyKey += `:${message.from.id}`;
                    configStoreKey += `:${message.from.id}`;
                }
                this.groupAdminsKey = `group_admin:${id}`;
                if (message.from?.id) {
                    chunkMessageKey = chunkMessageKey ? `${chunkMessageKey}:${message.from.id}` : undefined;
                    storeMediaMessageKey = storeMediaMessageKey ? `${storeMediaMessageKey}:${message.from.id}` : undefined;
                }
                break;
            default:
                break;
        }

        // 判断是否为话题模式
        if (message?.chat.is_forum && message?.is_topic_message) {
            if (message?.message_thread_id) {
                historyKey += `:${message.message_thread_id}`;
                configStoreKey += `:${message.message_thread_id}`;
            }
        }

        this.chatHistoryKey = historyKey;
        this.lastMessageKey = `last_message_id:${historyKey}`;
        this.configStoreKey = configStoreKey;
        this.chunkMessageKey = chunkMessageKey;
        this.storeMediaMessageKey = storeMediaMessageKey;

        // 不区分是否开启群组共享模式

        if (ENV.TELEGRAPH_NUM_LIMIT > 0) {
            this.telegraphAccessTokenKey = `telegraph_access_token:${id}`;
        }
    };
}

export class MiddleContext {
    originalMessageInfo: UnionData = { type: 'text' };
    history: HistoryItem[] = [];
    sender: MessageSender | null = null;
}

export class WorkerContextBase {
    SHARE_CONTEXT: ShareContext;
    MIDDLE_CONTEXT: MiddleContext = new MiddleContext();

    constructor(token: string, message: Telegram.Message) {
        this.SHARE_CONTEXT = new ShareContext(token, message);
    }
}

export class WorkerContext implements WorkerContextBase {
    // 用户配置
    USER_CONFIG: AgentUserConfig;
    SHARE_CONTEXT: ShareContext;
    MIDDLE_CONTEXT: MiddleContext;

    constructor(USER_CONFIG: AgentUserConfig, SHARE_CONTEXT: ShareContext, MIDDLE_CONTEXT: MiddleContext) {
        this.USER_CONFIG = USER_CONFIG;
        this.SHARE_CONTEXT = SHARE_CONTEXT;
        this.MIDDLE_CONTEXT = MIDDLE_CONTEXT;
    }

    static async from(SHARE_CONTEXT: ShareContext, MIDDLE_CONTEXT: MiddleContext): Promise<WorkerContext> {
        const USER_CONFIG = { ...ENV.USER_CONFIG };
        try {
            const userConfig: AgentUserConfig = JSON.parse(await ENV.DATABASE.get(SHARE_CONTEXT.configStoreKey));
            ConfigMerger.merge(USER_CONFIG, ConfigMerger.trim(userConfig, ENV.LOCK_USER_CONFIG_KEYS) || {});
        } catch (e) {
            console.warn(e);
        }
        return new WorkerContext(USER_CONFIG, SHARE_CONTEXT, MIDDLE_CONTEXT);
    }
}
