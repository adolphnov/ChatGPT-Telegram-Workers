import "../types/context.js";
import {
    CONST,
    CUSTOM_COMMAND,
    CUSTOM_COMMAND_DESCRIPTION,
    DATABASE,
    ENV,
    ENV_KEY_MAPPER,
    mergeEnvironment
} from '../config/env.js';
import {
    getChatRoleWithContext,
    sendMessageToTelegramWithContext,
    sendPhotoToTelegramWithContext,
    sendChatActionToTelegramWithContext
} from './telegram.js';
import {chatWithLLM} from '../agent/llm.js';
import {
    chatModelKey,
    currentChatModel,
    currentImageModel,
    imageModelKey,
    loadChatLLM,
    loadImageGen, customInfo
} from "../agent/agents.js";
import { trimUserConfig } from "../config/context.js";
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
  '/set': {
    scopes: [],
    fn: commandSetUserConfigs,
    needAuth: commandAuthCheck.shareModeGroup
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
  if (!subcommand.trim()) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.img);
  }
  try {
    
    if (!context.CURRENT_CHAT_CONTEXT) {
      context.CURRENT_CHAT_CONTEXT = {};
    }
    const gen = loadImageGen(context)?.request;
    if (!gen) {
      return sendMessageToTelegramWithContext(context)(`ERROR: Image generator not found`);
    }
    setTimeout(() => sendChatActionToTelegramWithContext(context)('upload_photo').catch(console.error), 0);
    
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
  helpMsg += '\n' + Object.keys(CUSTOM_COMMAND)
    .filter((key) => !!CUSTOM_COMMAND_DESCRIPTION[key])
    .map((key) => `${key}：${CUSTOM_COMMAND_DESCRIPTION[key]}`)
    .join('\n');
  context.CURRENT_CHAT_CONTEXT.parse_mode = null;
  context.CURRENT_CHAT_CONTEXT.entities = [
    // { type: 'code', offset: 0, length: helpMsg.length },
    { type: 'blockquote', offset: 0, length: helpMsg.length },
  ]

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
      return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.mode);
    }
    if (!context.USER_CONFIG.MODES?.[subcommand]) {
      const msg = `mode \`${subcommand}\` not exist`;
      return sendMessageToTelegramWithContext(context)(msg);
    }
    subcommand = `CURRENT_MODE=${subcommand}`;
  }
  const kv = subcommand.indexOf('=');
  if (kv === -1) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.setenv);
  }
  let key = subcommand.slice(0, kv);
  const value = subcommand.slice(kv + 1);
  key = ENV_KEY_MAPPER[key] || key;
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
      if (key.endsWith('_MODEL')) {
        context._info.config('model', value);
      } else if (key === 'CURRENT_MODE') {
        context._info.config('mode', value);
      }
      return null;
    }
    context.USER_CONFIG.DEFINE_KEYS.push(key);
    context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
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
    if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.setenvs);
    }
    const values = JSON.parse(subcommand);
    const configKeys = Object.keys(context.USER_CONFIG);
    for (const ent of Object.entries(values)) {
      let [key, value] = ent;
      key = ENV_KEY_MAPPER[key] || key;
      if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
        return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`);
      }
      if (!configKeys.includes(key)) {
        return sendMessageToTelegramWithContext(context)(`Key ${key} not found`);
      }
      mergeEnvironment(context.USER_CONFIG, {
        [key]: value,
      });
      if (processUpdate) {
        if (key.endsWith('_MODEL')) {
          context._info.config('model', value);
        } else if (key === 'CURRENT_MODE') {
          context._info.config('mode', value);
        }
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
 * /set 新版修改用户配置
 *
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @return {Promise<Response>}
 */
async function commandSetUserConfigs(message, command, subcommand, context) {
  try {
    if (!subcommand) {
      return sendMessageToTelegramWithContext(context)('```plaintext\n' + ENV.I18N.command.detail.set + '\n```');
    }
    const keys = Object.fromEntries(ENV.MAPPING_KEY.split('|').map((k) => k.split(':')));
    if (keys['-u']) {
      delete keys['-u'];
    }
    const values = Object.fromEntries(ENV.MAPPING_VALUE.split('|').map((k) => k.split(':')));
    const updateTagReg = /\s+-u(\s+|$)/;
    const needUpdate = updateTagReg.test(subcommand);
    subcommand = subcommand.replace(updateTagReg, '$1');

    const msgCommand = subcommand.matchAll(/(-\w+)\s+(.+?)(\s+|$)/g);
    let msg = '';
    let hasKey = false;

    for (const [, k, v] of msgCommand) {
      let key = keys[k],
        value = values[v];
      if (key) {
        if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
          return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`);
        }
        // if (key === 'SYSTEM_INIT_MESSAGE') {
        //   const role_perfix = '~';
        //   if (v?.startsWith(role_perfix)) {
        //     value = ENV.PROMPT[v.substring(1)];
        //     if (!value) {
        //       msg += `>\`${v} is not exist, will use default prompt\`\n`;
        //       value = ENV.I18N?.env?.system_init_message || 'You are a helpful assistant';
        //     }
        //   }
        // } else if (key === 'CURRENT_MODE') {
        //   if (!Object.keys(context.USER_CONFIG.MODES).includes(v)) {
        //     return sendMessageToTelegramWithContext(context)(`mode ${v} is not exist`);
        //   }
        //   context._info.config('mode', value || v);
        // }
        const role_perfix = '~';
        switch (key) {
          case 'SYSTEM_INIT_MESSAGE':
            if (v?.startsWith(role_perfix)) {
              value = ENV.PROMPT[v.substring(1)];
              if (!value) {
                msg += `>\`${v} is not exist, will use default prompt\`\n`;
                value = ENV.I18N?.env?.system_init_message || 'You are a helpful assistant';
                // continue;
              }  // else context._info.config('prompt', v.substring(1));
              // 静默继续向下执行
            }  
            break;
          case 'CHAT_MODEL':
            key = `${context.USER_CONFIG.AI_PROVIDER.toUpperCase()}_CHAT_MODEL`;
            break;
          case 'VISION_MODEL':
            key = `${context.USER_CONFIG.AI_PROVIDER.toUpperCase()}_VISION_MODEL`;
            break;
          case 'STT_MODEL':
            key = `${context.USER_CONFIG.AI_PROVIDER.toUpperCase()}_STT_MODEL`;
            break;
          case 'CURRENT_MODE':
            if (!Object.keys(context.USER_CONFIG.MODES).includes(v)) {
              return sendMessageToTelegramWithContext(context)(`mode ${v} is not exist`);
            }
            context._info.config('mode', v);
            break;
          default:
            break;
        }

        if (!Object.keys(context.USER_CONFIG).includes(key)) {
          return sendMessageToTelegramWithContext(context)(`Key ${key} not found`);
        }
        context.USER_CONFIG[key] = value || v;
        context.USER_CONFIG.DEFINE_KEYS.push(key);
        console.log(`/set ${key || 'unknown'} ${(value || v).substring(0, 6)}...'`);

        // if (key.endsWith('_MODEL')) {
        //   context._info.config('model', value);
        // } else if (key === 'CURRENT_MODE') {
        //   context._info.config('mode', v);
        // }
      } else return sendMessageToTelegramWithContext(context)(`Mapping Key ${k} is not exist`);
      if(!hasKey) hasKey = true;
    }
    if (needUpdate && hasKey) {
      context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
      await DATABASE.put(
        context.SHARE_CONTEXT.configStoreKey,
        JSON.stringify(trimUserConfig(trimUserConfig(context.USER_CONFIG))),
      );
      msg += '>`Update user config success`\n';
    }
    if (msg) await sendMessageToTelegramWithContext(context)(msg);
    return null;
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
  if (!subcommand) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.delenv)
  }
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
    if (subcommand.trim() !== "true") {
        return sendMessageToTelegramWithContext(context)('Please sure that you want clear all config, send `/clearenv true`');
      }
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

    try {
        const info = `https://raw.githubusercontent.com/TBXark/ChatGPT-Telegram-Workers/${ENV.UPDATE_BRANCH}/dist/buildinfo.json`;
        const online = await fetch(info).then((r) => r.json());
        const timeFormat = (ts) => {
            return new Date(ts * 1000).toLocaleString('en-US', {});
        };
        if (current.ts < online.ts) {
            return sendMessageToTelegramWithContext(context)(`New version detected: ${online.sha}(${timeFormat(online.ts)})\nCurrent version: ${current.sha}(${timeFormat(current.ts)})`);
        } else {
            return sendMessageToTelegramWithContext(context)(`Current version: ${current.sha}(${timeFormat(current.ts)}) is up to date`);
        }
    } catch (e) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
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
  const agent = {
    AI_PROVIDER: chatAgent,
    AI_IMAGE_PROVIDER: imageAgent,
  };
  if (chatModelKey(chatAgent)) {
    agent[chatModelKey(chatAgent)] = currentChatModel(chatAgent, context);
  }
  if (imageModelKey(imageAgent)) {
    agent[imageModelKey(imageAgent)] = currentImageModel(imageAgent, context);
  }
  agent.STT_MODEL = context.USER_CONFIG.OPENAI_STT_MODEL;
  agent.VISION_MODEL = context.USER_CONFIG.OPENAI_VISION_MODEL;
  let msg = `<pre>AGENT: ${JSON.stringify(agent, null, 2)}\n` + customInfo(context.USER_CONFIG) + '\n</pre>';
  if (ENV.DEV_MODE) {
    const shareCtx = { ...context.SHARE_CONTEXT };
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
    msg += '</pre>';
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
        let nextText = text;
        if (!(history && Array.isArray(history) && history.length > 0)) {
            throw new Error('History not found');
        }
        const historyCopy = structuredClone(history);
        while (true) {
            const data = historyCopy.pop();
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
        return {history: historyCopy, text: nextText};
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
    if (!context._info.msg_type) {
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

  const customKey = Object.keys(CUSTOM_COMMAND).find((k) => message.text === k || message.text.startsWith(k + ' '));
  if (customKey) {
    message.text = message.text.replace(customKey, CUSTOM_COMMAND[customKey]);
  }

  for (const key in commandHandlers) {
    if (message.text === key || message.text.startsWith(key + ' ')) {
      const command = commandHandlers[key];
      const commandLine =/^.*(\n|$)/.exec(message.text)[0];
      message.text = message.text.substring(commandLine.length);
      
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

      const subcommand = commandLine.substring(key.length).trim();
      try {
        const result = await command.fn(message, key, subcommand, context);
        console.log('[DONE] Command: ' + key + ' ' + subcommand);
        if (result instanceof Response) return result;
        if (message.text.length === 0) return new Response('None question');
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