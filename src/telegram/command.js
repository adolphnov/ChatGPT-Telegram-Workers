import "../types/context.js"
import {CONST, CUSTOM_COMMAND, CUSTOM_COMMAND_DESCRIPTION, DATABASE, ENV, mergeEnvironment} from '../config/env.js';
import {
    getChatRoleWithContext,
    sendChatActionToTelegramWithContext,
    sendMessageToTelegramWithContext,
    sendPhotoToTelegramWithContext,
} from './telegram.js';
import {chatWithLLM} from '../agent/llm.js';
import {currentChatModel, currentImageModel, loadChatLLM, loadImageGen} from "../agent/agents.js";
import { trimUserConfig } from "../config/context.js";
import { customInfo } from "../agent/agents.js";


const commandAuthCheck = {
    default: function (chatType) {
        if (CONST.GROUP_TYPES.includes(chatType)) {
            return ['administrator', 'creator'];
        }
        return false;
    },
    shareModeGroup: function (chatType) {
        if (CONST.GROUP_TYPES.includes(chatType)) {
            // 每个人在群里有上下文的时候，不限制
            if (!ENV.GROUP_CHAT_BOT_SHARE_MODE) {
                return false;
            }
            return ['administrator', 'creator'];
        }
        return false;
    },
};


const commandSortList = [
    '/new',
    '/redo',
    '/img',
    '/setenv',
    '/delenv',
    '/version',
    '/system',
    '/help',
    '/mode',
];

// 命令绑定
const commandHandlers = {
    '/help': {
        scopes: ['all_private_chats', 'all_chat_administrators'],
        fn: commandGetHelp,
    },
    '/new': {
        scopes: ['all_private_chats', 'all_group_chats', 'all_chat_administrators'],
        fn: commandCreateNewChatContext,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/start': {
        scopes: [],
        fn: commandCreateNewChatContext,
        needAuth: commandAuthCheck.default,
    },
    '/img': {
        scopes: ['all_private_chats', 'all_chat_administrators'],
        fn: commandGenerateImg,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/version': {
        scopes: ['all_private_chats', 'all_chat_administrators'],
        fn: commandFetchUpdate,
        needAuth: commandAuthCheck.default,
    },
    '/setenv': {
        scopes: [],
        fn: commandUpdateUserConfig,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/setenvs': {
        scopes: [],
        fn: commandUpdateUserConfigs,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/delenv': {
        scopes: [],
        fn: commandDeleteUserConfig,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/clearenv': {
        scopes: [],
        fn: commandClearUserConfig,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/system': {
        scopes: ['all_private_chats', 'all_chat_administrators'],
        fn: commandSystem,
        needAuth: commandAuthCheck.default,
    },
    '/redo': {
        scopes: ['all_private_chats', 'all_group_chats', 'all_chat_administrators'],
        fn: commandRegenerate,
        needAuth: commandAuthCheck.shareModeGroup,
    },
    '/mode': {
      scopes: [],
      fn: commandUpdateUserConfig,
      needAuth: commandAuthCheck.shareModeGroup,
    },
};

  
/**
 * /img 命令
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandGenerateImg(message, command, subcommand, context) {
  if (subcommand==='') {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.img.help);
  }
  try {
    setTimeout(() => sendChatActionToTelegramWithContext(context)('upload_photo').catch(console.error), 0);
    const provider = (context.USER_CONFIG.AI_IMAGE_PROVIDER == 'auto' ? 'openai' : context.USER_CONFIG.AI_PROVIDER);
    const PROCESS_INFO = {
      TYPE: 'text:image',
      PROVIDER_SOURCE: 'default',
      AI_PROVIDER: provider,
      MODEL: provider == 'openai'? context.USER_CONFIG.DALL_E_MODEL: context.USER_CONFIG.WORKERS_IMAGE_MODEL
    };
    if (!context.CURRENT_CHAT_CONTEXT) {
      context.CURRENT_CHAT_CONTEXT = {};
    }
    // context.CURRENT_CHAT_CONTEXT.PROCESS_INFO = PROCESS_INFO;
    ENV._MIDDLEINFO.process_info = PROCESS_INFO;
    const gen = loadImageGen(context)?.request;
    if (!gen) {
      return sendMessageToTelegramWithContext(context)(`ERROR: Image generator not found`);
    }
    // const startTime = performance.now();
    const img = await gen(subcommand, context);
    return sendPhotoToTelegramWithContext(context)(img);
  } catch (e) {
    console.error(e.message);
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
  }
}

/**
 * /help 获取帮助信息
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandGetHelp(message, command, subcommand, context) {
    let helpMsg = ENV.I18N.command.help.summary + '\n';
    helpMsg += Object.keys(commandHandlers)
            .map((key) => `${key}：${ENV.I18N.command.help[key.substring(1)]}`)
            .join('\n');
    helpMsg += Object.keys(CUSTOM_COMMAND)
            .filter((key) => !!CUSTOM_COMMAND_DESCRIPTION[key])
            .map((key) => `${key}：${CUSTOM_COMMAND_DESCRIPTION[key]}`)
            .join('\n');
    return sendMessageToTelegramWithContext(context)(helpMsg);
}

/**
 * /new /start 新的会话
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandCreateNewChatContext(message, command, subcommand, context) {
    try {
        await DATABASE.delete(context.SHARE_CONTEXT.chatHistoryKey);
        context.CURRENT_CHAT_CONTEXT.reply_markup = JSON.stringify({
            remove_keyboard: true,
            selective: true,
        });
        if (command === '/new') {
            return sendMessageToTelegramWithContext(context)(ENV.I18N.command.new.new_chat_start);
        } else {
            return sendMessageToTelegramWithContext(context)(`${ENV.I18N.command.new.new_chat_start}(${context.CURRENT_CHAT_CONTEXT.chat_id})`);
        }
    } catch (e) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
    }
}


/**
 * /setenv 用户配置修改
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandUpdateUserConfig(message, command, subcommand, context, processUpdate = false) {
  if (command == '/mode') {
    if (subcommand == 'all') {
      const msg = `<pre>mode清单:   \n- ${Object.keys(context.USER_CONFIG.MODES).join('\n- ')}</pre>`;
      context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
      return sendMessageToTelegramWithContext(context)(msg);
    } else if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(ENV.I18N.command.mode.help);
    }
    if (!context.USER_CONFIG.MODES?.[subcommand]) {
      const msg = ENV.I18N.command.setenv.update_config_error(new Error(`mode \`${subcommand}\` not exist`));
      return sendMessageToTelegramWithContext(context)(msg);
    }
    subcommand = `CURRENT_MODE=${subcommand}`;
  }
  const kv = subcommand.indexOf('=');
  if (kv === -1) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.setenv);
  }
  const key = subcommand.slice(0, kv);
  const value = subcommand.slice(kv + 1);
  if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
    return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`);
  }
  if (!Object.keys(context.USER_CONFIG).includes(key)) {
    return sendMessageToTelegramWithContext(context)(`Key ${key} not found`);
  }
  try {
    mergeEnvironment(context.USER_CONFIG, {
      [key]: value,
    });
    if (processUpdate) {
      ENV._MIDDLEINFO.updateProcess(context.USER_CONFIG, key, value);
      return null;
    }
    context.USER_CONFIG.DEFINE_KEYS.push(key);
    context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
    console.log('Update user config: ', key, context.USER_CONFIG[key]);
    await DATABASE.put(context.SHARE_CONTEXT.configStoreKey, JSON.stringify(trimUserConfig(context.USER_CONFIG)));
    return sendMessageToTelegramWithContext(context)('Update user config success');
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
  }
}

/**
 * /setenvs 批量用户配置修改
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandUpdateUserConfigs(message, command, subcommand, context, processUpdate = false) {
    try {
        const values = JSON.parse(subcommand);
        const configKeys = Object.keys(context.USER_CONFIG);
        for (const ent of Object.entries(values)) {
            const [key, value] = ent;
            if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
                return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`);
            }
            if (!configKeys.includes(key)) {
                return sendMessageToTelegramWithContext(context)(`Key ${key} not found`);
            }
            context.USER_CONFIG.DEFINE_KEYS.push(key);
            mergeEnvironment(context.USER_CONFIG, {
                [key]: value,
            })
            if (processUpdate) {
              ENV._MIDDLEINFO.updateProcess(context.USER_CONFIG, key, value);
              continue;
            }
            context.USER_CONFIG.DEFINE_KEYS.push(key);
            console.log("Update user config: ", key, context.USER_CONFIG[key]);
        }
        if (processUpdate) {
          return null;
        }
        
        context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
        await DATABASE.put(
            context.SHARE_CONTEXT.configStoreKey,
            JSON.stringify(trimUserConfig(trimUserConfig(context.USER_CONFIG))),
        );
        return sendMessageToTelegramWithContext(context)('Update user config success');
    } catch (e) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
    }
}

/**
 * /delenv 用户配置修改
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandDeleteUserConfig(message, command, subcommand, context) {
    if (ENV.LOCK_USER_CONFIG_KEYS.includes(subcommand)) {
        const msg = `Key ${subcommand} is locked`;
        return sendMessageToTelegramWithContext(context)(msg);
    }
    try {
        context.USER_CONFIG[subcommand] = null;
        context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter((key) => key !== subcommand);
        await DATABASE.put(
            context.SHARE_CONTEXT.configStoreKey,
            JSON.stringify(trimUserConfig(context.USER_CONFIG)),
        );
        return sendMessageToTelegramWithContext(context)('Delete user config success');
    } catch (e) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
    }
}


/**
 * /clearenv 清空用户配置
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandClearUserConfig(message, command, subcommand, context) {
    try {
        await DATABASE.put(
            context.SHARE_CONTEXT.configStoreKey,
            JSON.stringify({}),
        );
        return sendMessageToTelegramWithContext(context)('Clear user config success');
    } catch (e) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
    }
}


/**
 * /version 获得更新信息
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandFetchUpdate(message, command, subcommand, context) {

    const current = {
        ts: ENV.BUILD_TIMESTAMP,
        sha: ENV.BUILD_VERSION,
    };

    const repo = `https://raw.githubusercontent.com/TBXark/ChatGPT-Telegram-Workers/${ENV.UPDATE_BRANCH}`;
    const ts = `${repo}/dist/timestamp`;
    const info = `${repo}/dist/buildinfo.json`;

    let online = await fetch(info, config)
        .then((r) => r.json())
        .catch(() => null);
    if (!online) {
        online = await fetch(ts, config).then((r) => r.text())
            .then((ts) => ({ts: Number(ts.trim()), sha: 'unknown'}))
            .catch(() => ({ts: 0, sha: 'unknown'}));
    }

    if (current.ts < online.ts) {
        return sendMessageToTelegramWithContext(context)(`New version detected: ${online.sha}(${online.ts})\nCurrent version: ${current.sha}(${current.ts})`);
    } else {
        return sendMessageToTelegramWithContext(context)(`Current version: ${current.sha}(${current.ts}) is up to date`);
    }
}


/**
 * /system 获得系统信息
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandSystem(message, command, subcommand, context) {
    let chatAgent = loadChatLLM(context)?.name;
    let imageAgent = loadImageGen(context)?.name;
    let chatModel = currentChatModel(chatAgent, context)
    let imageModel = currentImageModel(imageAgent, context)
    let msg = `<pre>AGENT: ${
        JSON.stringify({
            CHAT_AGENT: chatAgent,
            CHAT_MODEL: chatModel,
            IMAGE_AGENT: imageAgent,
          IMAGE_MODEL: imageModel,
          STT_MODEL: context.USER_CONFIG.OPENAI_STT_MODEL,
          VISION_MODEL: context.USER_CONFIG.OPENAI_VISION_MODEL,
        }, null, 2)
    }\n` + customInfo(context.USER_CONFIG) + '\n</pre>';
    if (ENV.DEV_MODE) {
        const shareCtx = {...context.SHARE_CONTEXT};
        shareCtx.currentBotToken = '******';
        context.USER_CONFIG.OPENAI_API_KEY = ['******'];
        context.USER_CONFIG.AZURE_API_KEY = '******';
        context.USER_CONFIG.AZURE_PROXY_URL = '******';
        context.USER_CONFIG.AZURE_DALLE_API = '******';
        context.USER_CONFIG.CLOUDFLARE_ACCOUNT_ID = '******';
        context.USER_CONFIG.CLOUDFLARE_TOKEN = '******';
        context.USER_CONFIG.GOOGLE_API_KEY = '******';
        context.USER_CONFIG.MISTRAL_API_KEY = '******';
        context.USER_CONFIG.COHERE_API_KEY = '******';
        context.USER_CONFIG.ANTHROPIC_API_KEY = '******';
        const config = trimUserConfig(context.USER_CONFIG);
        msg = '<pre>\n' + msg;
        msg += `USER_CONFIG: ${JSON.stringify(config, null, 2)}\n`;
        msg += `CHAT_CONTEXT: ${JSON.stringify(context.CURRENT_CHAT_CONTEXT, null, 2)}\n`;
        msg += `SHARE_CONTEXT: ${JSON.stringify(shareCtx, null, 2)}\n`;
        msg += CUSTOM_TINFO(context.USER_CONFIG) + '\n'+ '</pre>';
    }
    context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
    return sendMessageToTelegramWithContext(context)(msg);
}

/**
 * /redo 重新生成上一条消息
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandRegenerate(message, command, subcommand, context) {
    const mf = (history, text) => {
        const {real, original} = history;
        let nextText = text;
        if (!real || !original || real.length === 0 || original.length === 0) {
            throw new Error('History not found');
        }
        while (true) {
            const data = real.pop();
            original.pop();
            if (data === undefined || data === null) {
                break;
            } else if (data.role === 'user') {
                if (text === '' || text === undefined || text === null) {
                    nextText = data.content;
                }
                break;
            }
        }
        if (subcommand) {
            nextText = subcommand;
        }
        return {history: {real, original}, text: nextText};
    };
    return chatWithLLM(null, context, mf);
}

/**
 * /echo 回显消息
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandEcho(message, command, subcommand, context) {
    let msg = '<pre>';
    msg += JSON.stringify({message}, null, 2);
    msg += '</pre>';
    context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
    return sendMessageToTelegramWithContext(context)(msg);
}

/**
 * 处理命令消息
 *
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
export async function handleCommandMessage(message, context) {
  if (!message.text) {
    if (!ENV._MIDDLEINFO.orignal_msg_info.msgType) {
      return sendMessageToTelegramWithContext(context)('Not support the message ');
    }
    return null;
  }
  if (ENV.DEV_MODE) {
    commandHandlers['/echo'] = {
      help: '[DEBUG ONLY] echo message',
      scopes: ['all_private_chats', 'all_chat_administrators'],
      fn: commandEcho,
      needAuth: commandAuthCheck.default,
    };
  }

  const customKey = Object.keys(CUSTOM_COMMAND).find((k) => message.text.startsWith(k));
  let commandMsg = message.text;

  if (customKey) {
    message.text = message.text.substring(customKey.length + 1).trim();
    commandMsg = CUSTOM_COMMAND[customKey];
  }

  for (const key in commandHandlers) {
    if (commandMsg === key || commandMsg.startsWith(key + ' ')) {
      const command = commandHandlers[key];
      try {
        // 如果存在权限条件
        if (command.needAuth) {
          const roleList = command.needAuth(context.SHARE_CONTEXT.chatType);
          if (roleList) {
            // 获取身份并判断
            const chatRole = await getChatRoleWithContext(context)(context.SHARE_CONTEXT.speakerId);
            if (chatRole === null) {
              return sendMessageToTelegramWithContext(context)('ERROR: Get chat role failed');
            }
            if (!roleList.includes(chatRole)) {
              return sendMessageToTelegramWithContext(context)(
                `ERROR: Permission denied, need ${roleList.join(' or ')}`,
              );
            }
          }
        }
      } catch (e) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
      }

      const subcommand = commandMsg.substring(key.length).trim();
      if (message.text && customKey && key.startsWith('/setenv')) {
        await command.fn(message, key, subcommand, context, true);
        break;
      }
      try {
        const result = await command.fn(message, key, subcommand, context);
        console.log('[DONE] Command: ' + key + ' ' + subcommand);
        return result;
      } catch (e) {
        return sendMessageToTelegramWithContext(context)(e.message);
      }
    }
  }
  // 除命令外, 以 / 开头 的文本不再处理
  if (message.text.startsWith('/')) {
    return sendMessageToTelegramWithContext(context)(`Oops! It's not a command.`);
  }
  return null;
}

/**
 * 绑定命令到Telegram
 *
 * @param {string} token
 * @return {Promise<{result: {}, ok: boolean}>}
 */
export async function bindCommandForTelegram(token) {
    const scopeCommandMap = {
        all_private_chats: [],
        all_group_chats: [],
        all_chat_administrators: [],
    };
    for (const key of commandSortList) {
        if (ENV.HIDE_COMMAND_BUTTONS.includes(key)) {
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(commandHandlers, key) && commandHandlers[key].scopes) {
            for (const scope of commandHandlers[key].scopes) {
                if (!scopeCommandMap[scope]) {
                    scopeCommandMap[scope] = [];
                }
                scopeCommandMap[scope].push(key);
            }
        }
    }

    const result = {};
    for (const scope in scopeCommandMap) {
        result[scope] = await fetch(
            `https://api.telegram.org/bot${token}/setMyCommands`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    commands: scopeCommandMap[scope].map((command) => ({
                        command,
                        description: ENV.I18N.command.help[command.substring(1)] || '',
                    })),
                    scope: {
                        type: scope,
                    },
                }),
            },
        ).then((res) => res.json());
    }
    return {ok: true, result: result};
}

/**
 * 获取所有命令的描述
 * @return {{description: *, command: *}[]}
 */
export function commandsDocument() {
    return Object.keys(commandHandlers).map((key) => {
        return {
            command: key,
            description: ENV.I18N.command.help[key.substring(1)],
        };
    });
}