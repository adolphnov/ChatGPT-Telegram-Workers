import type * as Telegram from 'telegram-bot-api-types';
import type { WorkerContext } from '../../config/context';
import type { ChosenInlineQueryHandler, InlineQueryHandler, MessageHandler } from './types';
import { CallbackQueryContext, ChosenInlineWorkerContext, InlineQueryContext, WorkerContextBase } from '../../config/context';
import { log } from '../../log/logger';
import { ChatHandler } from './chat';
import { GroupMention } from './group';
import {
    AnswerInlineQuery,
    CheckForwarding,
    CheckInlineQueryWhiteList,
    CommandHandler,
    EnvChecker,
    HandlerCallbackQuery,
    HandlerInlineQuery,
    InitUserConfig,
    IntelligentModelProcess,
    MessageFilter,
    OldMessageFilter,
    SaveLastMessage,
    StoreHistory,
    TagNeedDelete,
    WhiteListFilter,
} from './handlers';

function loadMessage(body: Telegram.Update, isForwarding: boolean) {
    switch (true) {
        case !!body.message:
            return (token: string) => handleMessage(token, body.message!, isForwarding);
        case !!body.inline_query:
            return (token: string) => handleInlineQuery(token, body.inline_query!);
        case !!body.callback_query:
            return (token: string) => handleCallbackQuery(token, body.callback_query!);
        case !!body.chosen_inline_result:
            return (token: string) => handleChosenInline(token, body.chosen_inline_result!);
        case !!body.edited_message:
            throw new Error('Ignore edited message');
        default:
            log.info(`Not support message type: ${JSON.stringify(body, null, 2)}`);
            throw new Error('Not support message type');
    }
}

const exitHanders: MessageHandler<any>[] = [new TagNeedDelete()];

export async function handleUpdate(token: string, update: Telegram.Update, headers?: Headers): Promise<Response | null> {
    log.debug(`handleUpdate`, update.message?.chat);
    const isForwarding = headers?.get('User-Agent') === 'Upstash-QStash';
    const messageHandler = loadMessage(update, isForwarding);
    return messageHandler(token);
}

async function handleMessage(token: string, message: Telegram.Message, isForwarding: boolean) {
    // 消息处理中间件
    const SHARE_HANDLER: MessageHandler<any>[] = [
    // 检查环境是否准备好: DATABASE
        new EnvChecker(),
        // 过滤非白名单用户, 提前过滤减少KV消耗
        new WhiteListFilter(),
        // 过滤不支持的消息(抛出异常结束消息处理) 忽略的消息
        new MessageFilter(),
        // 处理群消息，判断是否需要响应此条消息
        new GroupMention(),
        // 忽略旧消息
        new OldMessageFilter(),
        // DEBUG: 保存最后一条消息,按照需求自行调整此中间件位置
        new SaveLastMessage(),
        // 初始化用户配置
        new InitUserConfig(),
        // 动态模型处理
        new IntelligentModelProcess(),
        // 处理命令消息
        new CommandHandler(),
        // 检查是否是转发消息
        new CheckForwarding(),
        // 与llm聊天
        new ChatHandler(),
        // 缓存历史记录
        new StoreHistory(),
    ];
    // 延迟初始化用户配置
    const context = new WorkerContextBase(token, message);
    context.SHARE_CONTEXT.isForwarding = isForwarding;
    try {
        for (const handler of SHARE_HANDLER) {
            const result = await handler.handle(message, context);
            if (result instanceof Response) {
                break;
            }
        }
        log.info(`[MESSAGE HANDLER] handle message end, to handle exit handlers`);

        for (const handler of exitHanders) {
            const result = await handler.handle(message, context);
            if (result && result instanceof Response) {
                return result;
            }
        }
    } catch (e) {
        return catchError(e as Error);
    }

    return null;
}

async function handleCallbackQuery(token: string, callbackQuery: Telegram.CallbackQuery) {
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

async function handleInlineQuery(token: string, inlineQuery: Telegram.InlineQuery) {
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

async function handleChosenInline(token: string, chosenInlineQuery: Telegram.ChosenInlineResult) {
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

function catchError(e: Error) {
    console.error(e.message);
    return new Response(JSON.stringify({
        message: e.message,
        stack: e.stack,
    }), { status: 500 });
}
