/* eslint-disable unused-imports/no-unused-vars */
/* eslint-disable no-cond-assign */
import type { CoreUserMessage } from 'ai';
import type * as Telegram from 'telegram-bot-api-types';
import type { HistoryItem } from '../../agent/types';
import type { WorkerContext } from '../../config/context';
import type { AgentUserConfig } from '../../config/env';
import type { MessageSender } from '../utils/send';
import type { UnionData } from '../utils/utils';
import type { CommandHandler, InlineItem, ScopeType } from './types';
import { authChecker } from '.';
import { CHAT_AGENTS, customInfo, IMAGE_AGENTS, loadChatLLM, loadImageGen } from '../../agent';
import { ENV, ENV_KEY_MAPPER } from '../../config/env';
import { ConfigMerger } from '../../config/merger';
import { getLogSingleton } from '../../log/logDecortor';
import { log } from '../../log/logger';
import { tools } from '../../tools';
import { WssRequest } from '../../utils/others/wsrequest';
import { createTelegramBotAPI } from '../api';
import { chatWithLLM, OnStreamHander, sendImages } from '../handler/chat';
import { escape } from '../utils/md2tgmd';
import { sendAction } from '../utils/send';
import { chunckArray, isCfWorker, isTelegramChatTypeGroup, UUIDv4 } from '../utils/utils';

export const COMMAND_AUTH_CHECKER = {
    default(chatType: string): string[] | null {
        if (isTelegramChatTypeGroup(chatType)) {
            return ['administrator', 'creator'];
        }
        return null;
    },
    shareModeGroup(chatType: string): string[] | null {
        if (isTelegramChatTypeGroup(chatType)) {
            // 每个人在群里有上下文的时候，不限制
            if (!ENV.GROUP_CHAT_BOT_SHARE_MODE) {
                return null;
            }
            return ['administrator', 'creator'];
        }
        return null;
    },
};

export class ImgCommandHandler implements CommandHandler {
    command = '/img';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        if (subcommand === '') {
            return sender.sendPlainText(ENV.I18N.command.help.img);
        }
        try {
            const agent = loadImageGen(context.USER_CONFIG);
            if (!agent) {
                return sender.sendPlainText('ERROR: Image generator not found');
            }
            sendAction(context.SHARE_CONTEXT.botToken, message.chat.id, 'upload_photo');
            await sender.sendPlainText('Please wait a moment...');
            const img = await agent.request(subcommand, context.USER_CONFIG);
            log.info('img', img);
            const resp = await sendImages(img, ENV.SEND_IMAGE_AS_FILE, sender, context.USER_CONFIG);

            if (!resp.ok) {
                return sender.sendPlainText(`ERROR: ${resp.statusText} ${await resp.text()}`);
            }
            return resp;
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class HelpCommandHandler implements CommandHandler {
    command = '/help';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        let helpMsg = `${ENV.I18N.command.help.summary}\n`;
        for (const [k, v] of Object.entries(ENV.I18N.command.help)) {
            if (k === 'summary') {
                continue;
            }
            helpMsg += `/${k}：${v}\n`;
        }
        for (const [k, v] of Object.entries(ENV.CUSTOM_COMMAND)) {
            if (v.description) {
                helpMsg += `${k}：${v.description}\n`;
            }
        }
        for (const [k, v] of Object.entries(ENV.PLUGINS_COMMAND)) {
            if (v.description) {
                helpMsg += `${k}：${v.description}\n`;
            }
        }
        helpMsg = helpMsg.split('\n').map(line => `> ${line}`).join('\n');
        return sender.sendRichText(helpMsg, 'MarkdownV2', 'tip');
    };
}

class BaseNewCommandHandler {
    static async handle(showID: boolean, message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> {
        await ENV.DATABASE.delete(context.SHARE_CONTEXT.chatHistoryKey);
        const text = ENV.I18N.command.new.new_chat_start + (showID ? `(${message.chat.id})` : '');
        const params: Telegram.SendMessageParams = {
            chat_id: message.chat.id,
            message_thread_id: (message.is_topic_message && message.message_thread_id) || undefined,
            text,
        };
        if (ENV.SHOW_REPLY_BUTTON && !isTelegramChatTypeGroup(message.chat.type)) {
            params.reply_markup = {
                keyboard: [[{ text: '/new' }, { text: '/redo' }]],
                selective: true,
                resize_keyboard: true,
                one_time_keyboard: false,
            };
        } else {
            params.reply_markup = {
                remove_keyboard: true,
                selective: true,
            };
        }
        return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage(params);
    }
}

export class NewCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/new';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(false, message, subcommand, context);
    };
}

export class StartCommandHandler extends BaseNewCommandHandler implements CommandHandler {
    command = '/start';
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<Response> => {
        return BaseNewCommandHandler.handle(true, message, subcommand, context);
    };
}

export class SetEnvCommandHandler implements CommandHandler {
    command = '/setenv';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const kv = subcommand.indexOf('=');
        if (kv === -1) {
            return sender.sendPlainText(ENV.I18N.command.help.setenv);
        }
        let key = subcommand.slice(0, kv);
        const value = subcommand.slice(kv + 1);
        key = ENV_KEY_MAPPER[key] || key;
        if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
            return sender.sendPlainText(`Key ${key} is locked`);
        }
        if (!Object.keys(context.USER_CONFIG).includes(key)) {
            return sender.sendPlainText(`Key ${key} not found`);
        }
        try {
            context.USER_CONFIG.DEFINE_KEYS.push(key);
            context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
            ConfigMerger.merge(context.USER_CONFIG, {
                [key]: value,
            });
            log.info('Update user config: ', key, context.USER_CONFIG[key]);
            await ENV.DATABASE.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify(ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS)),
            );
            return sender.sendPlainText('Update user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class SetEnvsCommandHandler implements CommandHandler {
    command = '/setenvs';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        try {
            const values = JSON.parse(subcommand);
            const configKeys = Object.keys(context.USER_CONFIG);
            for (const ent of Object.entries(values)) {
                let [key, value] = ent;
                key = ENV_KEY_MAPPER[key] || key;
                if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
                    return sender.sendPlainText(`Key ${key} is locked`);
                }
                if (!configKeys.includes(key)) {
                    return sender.sendPlainText(`Key ${key} not found`);
                }
                context.USER_CONFIG.DEFINE_KEYS.push(key);
                ConfigMerger.merge(context.USER_CONFIG, {
                    [key]: value,
                });
                log.info('Update user config: ', key, context.USER_CONFIG[key]);
            }
            context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
            await ENV.DATABASE.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify(ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS)),
            );
            return sender.sendPlainText('Update user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class DelEnvCommandHandler implements CommandHandler {
    command = '/delenv';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        if (ENV.LOCK_USER_CONFIG_KEYS.includes(subcommand)) {
            const msg = `Key ${subcommand} is locked`;
            return sender.sendPlainText(msg);
        }
        try {
            context.USER_CONFIG[subcommand] = null;
            context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter(key => key !== subcommand);
            await ENV.DATABASE.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify(ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS)),
            );
            return sender.sendPlainText('Delete user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class ClearEnvCommandHandler implements CommandHandler {
    command = '/clearenv';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        try {
            await ENV.DATABASE.put(
                context.SHARE_CONTEXT.configStoreKey,
                JSON.stringify({}),
            );
            return sender.sendPlainText('Clear user config success');
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
        ;
    };
}

export class VersionCommandHandler implements CommandHandler {
    command = '/version';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const current = {
            ts: ENV.BUILD_TIMESTAMP,
            sha: ENV.BUILD_VERSION,
        };
        try {
            const info = `https://raw.githubusercontent.com/TBXark/ChatGPT-Telegram-Workers/${ENV.UPDATE_BRANCH}/dist/buildinfo.json`;
            const online = await fetch(info).then(r => r.json()) as { ts: number; sha: string };
            const timeFormat = (ts: number): string => {
                return new Date(ts * 1000).toLocaleString('en-US', {});
            };
            if (current.ts < online.ts) {
                const text = `New version detected: ${online.sha}(${timeFormat(online.ts)})\nCurrent version: ${current.sha}(${timeFormat(current.ts)})`;
                return sender.sendPlainText(text);
            } else {
                const text = `Current version: ${current.sha}(${timeFormat(current.ts)}) is up to date`;
                return sender.sendPlainText(text);
            }
        } catch (e) {
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };
}

export class SystemCommandHandler implements CommandHandler {
    command = '/system';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        // const sender = MessageSender.from(context.SHARE_CONTEXT.botToken, message);
        const chatAgent = loadChatLLM(context.USER_CONFIG);
        const imageAgent = loadImageGen(context.USER_CONFIG);
        const agent = {
            AI_PROVIDER: chatAgent?.name,
            [chatAgent?.modelKey || 'AI_PROVIDER_NOT_FOUND']: chatAgent?.model(context.USER_CONFIG),
            TOOL_MODEL: context.USER_CONFIG.TOOL_MODEL || 'same as chat model',
            AI_IMAGE_PROVIDER: imageAgent?.name,
            [imageAgent?.modelKey || 'AI_IMAGE_PROVIDER_NOT_FOUND']: imageAgent?.model(context.USER_CONFIG),
            STT_MODEL: context.USER_CONFIG.OPENAI_STT_MODEL,
            VISION_MODEL: context.USER_CONFIG.OPENAI_VISION_MODEL,
            IMAGE_MODEL: context.USER_CONFIG.IMAGE_MODEL,
        };
        let msg = `<pre>AGENT: ${JSON.stringify(agent, null, 2)}\nOTHERS: ${customInfo(context.USER_CONFIG)
        }\n</pre>`;
        if (ENV.DEV_MODE) {
            const shareCtx = { ...context.SHARE_CONTEXT };
            shareCtx.botToken = '******';
            context.USER_CONFIG.OPENAI_API_KEY = ['******'];
            context.USER_CONFIG.AZURE_API_KEY = '******';
            context.USER_CONFIG.AZURE_COMPLETIONS_API = '******';
            context.USER_CONFIG.AZURE_DALLE_API = '******';
            context.USER_CONFIG.CLOUDFLARE_ACCOUNT_ID = '******';
            context.USER_CONFIG.CLOUDFLARE_TOKEN = '******';
            context.USER_CONFIG.GOOGLE_API_KEY = '******';
            context.USER_CONFIG.MISTRAL_API_KEY = '******';
            context.USER_CONFIG.COHERE_API_KEY = '******';
            context.USER_CONFIG.ANTHROPIC_API_KEY = '******';
            const config = ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS);
            msg = `<pre>\n${msg}`;
            msg += `USER_CONFIG: ${JSON.stringify(config, null, 2)}\n`;
            msg += `CHAT_CONTEXT: ${JSON.stringify(sender.context || {}, null, 2)}\n`;
            msg += `SHARE_CONTEXT: ${JSON.stringify(shareCtx, null, 2)}\n`;
            msg += '</pre>';
        }
        return sender.sendRichText(msg, 'HTML', 'tip');
    };
}

export class RedoCommandHandler implements CommandHandler {
    command = '/redo';
    scopes: ScopeType[] = ['all_private_chats', 'all_group_chats', 'all_chat_administrators'];
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext): Promise<UnionData | Response> => {
        const mf = (history: HistoryItem[], message: CoreUserMessage | null): any => {
            let nextMessage = message;
            if (!(history && Array.isArray(history) && history.length > 0)) {
                throw new Error('History not found');
            }
            const historyCopy = structuredClone(history);
            while (true) {
                const data = historyCopy.pop();
                if (data === undefined || data === null) {
                    break;
                } else if (data.role === 'user') {
                    nextMessage = data;
                    break;
                }
            }
            if (subcommand) {
                nextMessage = {
                    role: 'user',
                    content: subcommand,
                };
            }
            if (nextMessage === null) {
                throw new Error('Redo message not found');
            }
            return { history: historyCopy, message: nextMessage };
        };
        return chatWithLLM(message, null, context, mf);
    };
}

export class EchoCommandHandler implements CommandHandler {
    command = '/echo';
    handle = (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        let msg = '<pre>';
        msg += JSON.stringify({ message }, null, 2);
        msg += '</pre>';
        return sender.sendRichText(msg, 'HTML');
    };
}

export class SetCommandHandler implements CommandHandler {
    command = '/set';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    relaxAuth = true;
    handle = async (
        message: Telegram.Message,
        subcommand: string,
        context: WorkerContext,
        sender: MessageSender,
    ): Promise<Response | null> => {
        try {
            if (!subcommand) {
                const detailSet = ENV.I18N.command?.detail?.set || 'Have no detailed information in the language';
                return sender.sendRichText(`\`\`\`plaintext\n${detailSet}\n\`\`\``, 'MarkdownV2');
            }

            const { keys, values } = this.parseMappings(context);
            const { flags, remainingText } = this.tokenizeSubcommand(subcommand);
            const needUpdate = remainingText.trim() === '';
            let msg = '';
            const updatedKeys: string[] = [];

            if (context.USER_CONFIG.AI_PROVIDER === 'auto') {
                context.USER_CONFIG.AI_PROVIDER = 'openai';
            }

            for (const { flag, value } of flags) {
                const result = await this.processSubcommand(flag, value, keys, values, context, sender);
                if (result instanceof Response) {
                    return result;
                }
                updatedKeys.push(result);
            }
            await this.RelaxAuthCheck(message, context, updatedKeys, needUpdate);
            if (needUpdate && updatedKeys.length > 0 && context.SHARE_CONTEXT?.configStoreKey) {
                context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
                await ENV.DATABASE.put(
                    context.SHARE_CONTEXT.configStoreKey,
                    JSON.stringify(ConfigMerger.trim(context.USER_CONFIG, ENV.LOCK_USER_CONFIG_KEYS)),
                );
                msg += 'Update user config successful';
            }

            if (msg) {
                await sender.sendPlainText(msg);
            }

            if (remainingText) {
                message.text = remainingText;
                return null;
            }

            return new Response('success');
        } catch (e) {
            log.error(`/set error: ${(e as Error).message}`);
            return sender.sendPlainText(`ERROR: ${(e as Error).message}`);
        }
    };

    private parseMappings(context: WorkerContext): { keys: Record<string, string>; values: Record<string, string> } {
        const parseMapping = (mapping: string): Record<string, string> => {
            if (!mapping) {
                return {};
            }
            const entries: [string, string][] = [];
            const pairs = mapping.split('|');
            for (const k of pairs) {
                const [key, ...rest] = k.split(':');
                if (!key) {
                    console.warn(`Invalid key in mapping: "${k}"`);
                    continue;
                }
                // 防止映射值中同样包含:
                const value = rest.length > 0 ? rest.join(':') : '';
                entries.push([key, value]);
            }
            return Object.fromEntries(entries);
        };

        const keys = parseMapping(context.USER_CONFIG.MAPPING_KEY);
        const values = parseMapping(context.USER_CONFIG.MAPPING_VALUE);
        return { keys, values };
    }

    private tokenizeSubcommand(subcommand: string): { flags: { flag: string; value: string }[]; remainingText: string } {
        const regex = /^\s*(-\w+)\s+(".*?"|'.*?'|\S+|$)/;
        const flags: { flag: string; value: string }[] = [];
        let text = subcommand;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            const flag = match[1];
            let value = match[2];
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
                value = value.slice(1, -1);
            }
            flags.push({ flag, value });
            text = text.slice(match[0].length);
        }

        const remainingText = text.trim();
        log.info(`/set flags: ${JSON.stringify(flags, null, 2)}, remainingText: ${remainingText}`);
        return { flags, remainingText };
    }

    private async processSubcommand(
        flag: string,
        value: string,
        keys: Record<string, string>,
        values: Record<string, any>,
        context: WorkerContext,
        sender: MessageSender,
    ): Promise<string | Response> {
        let key = keys[flag];
        let mappedValue = values[value] ?? value;

        if (!key) {
            throw new Error(`Mapping Key ${flag} not found`);
        }

        if (ENV.LOCK_USER_CONFIG_KEYS.includes(key) && sender) {
            return sender.sendPlainText(`Key ${key} is locked`);
        }

        switch (key) {
            case 'SYSTEM_INIT_MESSAGE':
                mappedValue = context.USER_CONFIG.PROMPT[value] || value;
                break;
            case 'CHAT_MODEL':
            case 'VISION_MODEL':
            case 'STT_MODEL':
                key = context.USER_CONFIG.AI_PROVIDER
                    ? `${context.USER_CONFIG.AI_PROVIDER.toUpperCase()}_${key}`
                    : key;
                break;
            case 'CURRENT_MODE':
                if (!Object.keys(context.USER_CONFIG.MODES).includes(value)) {
                    return sender.sendPlainText(`mode ${value} not found. Support modes: ${Object.keys(context.USER_CONFIG.MODES).join(', ')}`);
                }
                break;
            case 'USE_TOOLS':
                if (value === 'on') {
                    mappedValue = Object.keys(tools);
                } else if (value === 'off') {
                    mappedValue = [];
                }
                break;
            default:
                break;
        }

        if (!(key in context.USER_CONFIG)) {
            return sender.sendPlainText(`Key ${key} not found`);
        }

        if (typeof context.USER_CONFIG[key] === 'boolean') {
            mappedValue = typeof mappedValue === 'boolean' ? mappedValue : mappedValue === 'true';
        }

        context.USER_CONFIG[key] = mappedValue;
        if (!context.USER_CONFIG.DEFINE_KEYS.includes(key)) {
            context.USER_CONFIG.DEFINE_KEYS.push(key);
        }
        log.info(`/set ${key} ${(JSON.stringify(mappedValue) || value).substring(0, 100)}...`);
        return key;
    }

    private async RelaxAuthCheck(message: Telegram.Message, context: WorkerContext, keys: string[], needUpdate: boolean) {
        if (!this.relaxAuth && ENV.RELAX_AUTH_KEYS.length === 0) {
            return;
        }
        if (needUpdate) {
            await authChecker(this, message, context);
        } else if (keys.length > 0 && keys.some(key => !ENV.RELAX_AUTH_KEYS.includes(key))) {
            await authChecker(this, message, context);
        }
    }
}

export class PerplexityCommandHandler implements CommandHandler {
    command = '/pplx';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        if (isCfWorker) {
            return sender.sendPlainText('Due to the limitation of browser, Perplexity is not supported in worker / browser');
        }
        if (!ENV.PPLX_COOKIE) {
            return sender.sendPlainText('Perplexity cookie is not set');
        }
        const supportedModes = ['internet', 'scholar', 'writing', 'wolfram', 'youtube', 'reddit'];
        const match = subcommand.split(' ')[0];
        const mode = supportedModes.find(m => match === m) || 'internet';
        if (mode === match) {
            subcommand = subcommand.slice(match.length).trim();
        }
        if (!subcommand) {
            return sender.sendPlainText('Please input your query');
        }
        const perplexityMessageData = {
            version: '2.9',
            source: 'default',
            attachments: [],
            language: 'en-GB',
            timezone: 'Europe/London',
            search_focus: mode,
            frontend_uuid: UUIDv4(),
            mode: 'concise',
            is_related_query: false,
            is_default_related_query: false,
            visitor_id: UUIDv4(),
            frontend_context_uuid: UUIDv4(),
            prompt_source: 'user',
            query_source: 'home',
        };

        const perplexityMessage = [`42["perplexity_ask", "${subcommand}", ${JSON.stringify(perplexityMessageData)}]`];

        const perplexityWsUrl = 'wss://www.perplexity.ai/socket.io/?EIO=4&transport=websocket';
        const perplexityWsOptions = {
            headers: {
                'Cookie': ENV.PPLX_COOKIE,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'priority': 'u=1, i',
                'Referer': 'https://www.perplexity.ai/',
            },
            rejectUnauthorized: false,
        };
        const resp = await (await sender.sendRichText('Perplexity is asking...')).json();
        // sender.update({
        //     message_id: resp.result.message_id,
        // });

        const onStream = OnStreamHander(sender, context, subcommand);
        const logs = getLogSingleton(context.USER_CONFIG);
        logs.chat.model.push(`Perplexity ${mode}`);
        const startTime = Date.now();
        const result = await WssRequest(perplexityWsUrl, null, perplexityWsOptions, perplexityMessage, { onStream }).catch(console.error);
        logs.chat.time.push(((Date.now() - startTime) / 1e3).toFixed(1));
        await onStream.end?.(result);
        return new Response('success');
    };
}

export class InlineCommandHandler implements CommandHandler {
    command = '/settings';
    scopes: ScopeType[] = ['all_private_chats', 'all_chat_administrators'];
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender?: MessageSender): Promise<Response> => {
        const defaultInlineKeys = this.defaultInlineKeys(context.USER_CONFIG);
        const currentSettings = this.settingsMessage(context.USER_CONFIG, defaultInlineKeys);

        return createTelegramBotAPI(context.SHARE_CONTEXT.botToken).sendMessage({
            chat_id: message.chat.id,
            ...(message.chat.type === 'private' ? {} : { reply_to_message_id: message.message_id }),
            text: escape(currentSettings.split('\n')),
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: this.inlineKeyboard(context.USER_CONFIG, defaultInlineKeys),
            },
        });
    };

    defaultInlineKeys = (context: AgentUserConfig): Record<string, InlineItem> => {
        const chatAgent = loadChatLLM(context);
        const imageAgent = loadImageGen(context);
        return {
            INLINE_AGENTS: {
                label: 'Agent',
                data: 'INLINE_AGENTS',
                config_key: 'AI_PROVIDER',
                available_values: CHAT_AGENTS.map(agent => agent.name),
            },
            INLINE_IMAGE_AGENTS: {
                label: 'Image Agent',
                data: 'INLINE_IMAGE_AGENTS',
                config_key: 'AI_IMAGE_PROVIDER',
                available_values: IMAGE_AGENTS.map(agent => agent.name),
            },
            INLINE_CHAT_MODELS: {
                label: 'Chat Model',
                data: 'INLINE_CHAT_MODELS',
                config_key: chatAgent?.modelKey || 'None',
                available_values: context.INLINE_CHAT_MODELS || [context[chatAgent?.modelKey || '']],
            },
            INLINE_VISION_MODELS: {
                label: 'Vision Model',
                data: 'INLINE_VISION_MODELS',
                config_key: chatAgent?.name === 'openai' ? 'OPENAI_VISION_MODEL' : chatAgent?.modelKey || 'None',
                available_values: context.INLINE_VISION_MODELS || [context[chatAgent?.name === 'openai' ? 'OPENAI_VISION_MODEL' : chatAgent?.modelKey || '']],
            },
            INLINE_IMAGE_MODELS: {
                label: 'Image Model',
                data: 'INLINE_IMAGE_MODELS',
                config_key: imageAgent?.modelKey || '',
                available_values: context.INLINE_IMAGE_MODELS || [context[imageAgent?.modelKey || '']],
            },
            INLINE_TOOL_MODELS: {
                label: 'Tool Model',
                data: 'INLINE_TOOL_MODELS',
                config_key: chatAgent?.modelKey || 'None',
                available_values: context.INLINE_TOOL_MODELS || [context[chatAgent?.modelKey || '']],
            },
            INLINE_FUNCTION_TOOLS: {
                label: 'Tools',
                data: 'INLINE_FUNCTION_TOOLS',
                config_key: 'USE_TOOLS',
                available_values: [...new Set([...Object.keys(tools), ...Object.keys(ENV.PLUGINS_FUNCTION)])],
            },
        };
    };

    settingsMessage = (context: AgentUserConfig, inlineKeys: Record<string, InlineItem>) => {
        const menu = '\n当前配置:\n';
        const currentSettings = `${menu}\n${Object.entries(inlineKeys).map(([_, { label, config_key }]) => {
            return `\`${label}: ${context[config_key] || 'None'}\``;
        }).join('\n')}`;
        return currentSettings;
    };

    inlineKeyboard = (context: AgentUserConfig, inlineKeys: Record<string, InlineItem>) => {
        const inline_keyboard_list = Object.entries(inlineKeys).reduce<Telegram.InlineKeyboardButton[]>((acc, [key, { available_values, label }]) => {
            if (available_values.length > 0) {
                acc.push({
                    text: label,
                    callback_data: key,
                });
            }
            return acc;
        }, [] as Telegram.InlineKeyboardButton[]);
        inline_keyboard_list.push({
            text: '❌',
            callback_data: 'CLOSE',
        });
        return chunckArray(inline_keyboard_list, 3);
    };
}

export class KlingAICommandHandler implements CommandHandler {
    command = '/kling';
    needAuth = COMMAND_AUTH_CHECKER.shareModeGroup;
    handle = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender): Promise<Response> => {
        if (context.USER_CONFIG.KLINGAI_COOKIE.length === 0) {
            return sender.sendPlainText('KlingAI token is not set');
        }
        if (subcommand.trim() === '') {
            return sender.sendPlainText('Please input your prompt');
        }
        return this.generate(message, subcommand, context, sender);
    };

    generate = async (message: Telegram.Message, subcommand: string, context: WorkerContext, sender: MessageSender) => {
        let prompt = subcommand.trim();
        let number = context.USER_CONFIG.KLINGAI_IMAGE_COUNT;
        const match = /^\d+/.exec(prompt);
        if (match) {
            number = Number.parseInt(match[0]);
            prompt = prompt.slice(match[0].length);
        }
        const COOKIES = context.USER_CONFIG.KLINGAI_COOKIE;
        let cookie = '';
        if (COOKIES.length > 0) {
            cookie = COOKIES[Math.floor(Math.random() * COOKIES.length)];
        } else {
            throw new Error('No KlingAI cookie found');
        }
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Cookie': cookie,
        };

        const body = {
            arguments: [
                { name: 'prompt', value: prompt },
                { name: 'style', value: '默认' },
                { name: 'aspect_ratio', value: context.USER_CONFIG.KLINGAI_IMAGE_RATIO },
                { name: 'imageCount', value: number },
                { name: 'biz', value: 'klingai' },
            ],
            type: 'mmu_txt2img_aiweb',
            inputs: [] as any[],
        };

        if (context.MIDDEL_CONTEXT.originalMessageInfo?.type === 'image' && context.MIDDEL_CONTEXT.originalMessageInfo.id?.[0]) {
            const img_id = context.MIDDEL_CONTEXT.originalMessageInfo.id?.[0];
            const img_url = await this.getFileUrl(img_id, context, headers);
            log.info(`Uploaded image url: ${img_url}`);
            body.inputs.push({ name: 'input', url: img_url, inputType: 'URL' });
            body.arguments.push({ name: 'fidelity', value: 0.5 });
            body.type = 'mmu_img2img_aiweb';
        }
        const resp = await fetch(`https://klingai.com/api/task/submit`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        }).then(res => res.json());
        const taskId = resp.data?.task?.id;
        if (!taskId) {
            console.error(JSON.stringify(resp));
            throw new Error(resp.message || 'Failed to get task id, see logs for more details');
        }
        sender.sendRichText('`Please wait a moment...`', 'MarkdownV2', 'tip');
        return this.handleTask(taskId, headers, sender);
    };

    handleTask = async (taskId: string, headers: Record<string, string>, sender: MessageSender) => {
        const MAX_WAIT_TIME = 600_000;
        const startTime = Date.now();
        while (true) {
            const resp = await fetch(`https://klingai.com/api/task/status?taskId=${taskId}`, {
                headers,
            }).then(res => res.json());
            if (resp.data?.status === 99) {
                const pics = resp.data.works.map(({ resource }: { resource: { resource: string } }) => ({
                    type: 'photo',
                    media: resource.resource,
                })).filter((i: { media: string }) => i.media);
                if (pics.length > 0) {
                    log.info(`KlingAI image urls: ${pics.map((i: { media: any }) => i.media).join(', ')}`);
                    return sender.sendMediaGroup(pics);
                }
                console.error(JSON.stringify(resp.data, null, 2));
                throw new Error(`KlingAI Task failed, see logs for more details`);
            }
            if (Date.now() - startTime > MAX_WAIT_TIME) {
                throw new Error(`KlingAI Task timeout`);
            }
            await new Promise(resolve => setTimeout(resolve, 10_000));
        }
    };

    getFileUrl = async (file_id: string, context: WorkerContext, headers: Record<string, string>) => {
        const api = createTelegramBotAPI(context.SHARE_CONTEXT.botToken);
        const img_path = (await api.getFileWithReturns({ file_id }).then(res => res.result)).file_path;
        const img_blob = await fetch(`https://api.telegram.org/file/bot${context.SHARE_CONTEXT.botToken}/${img_path}`, {
        }).then(res => res.blob());

        const { token, domain } = await this.getUploadFileTokenAndEndpoint(headers);
        await fetch(`https://${domain}/api/upload/fragment?upload_token=${token}&fragment_id=0`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/octet-stream',
            },
            body: img_blob,
        });

        await fetch(`https://${domain}/api/upload/complete?fragment_count=1&upload_token=${token}`, {
            method: 'POST',
            headers,
        });

        const url_resp = await fetch(`https://klingai.com/api/upload/verify/token?token=${token}`, {
            headers,
        }).then(res => res.json());
        if (!url_resp.data?.url) {
            throw new Error(url_resp.data.message || 'Failed to get file url, see logs for more details');
        }
        return url_resp.data.url;
    };

    getUploadFileTokenAndEndpoint = async (headers: Record<string, string>) => {
        const resp = await fetch(`https://klingai.com/api/upload/issue/token?filename=image.jpg`, {
            headers,
        }).then(res => res.json());
        if (!resp.data.token || !resp.data?.httpEndpoints?.[0]) {
            throw new Error(`Failed to upload file, see logs for more details`);
        }
        return {
            token: resp.data.token,
            domain: resp.data.httpEndpoints[0],
        };
    };
}
