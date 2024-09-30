/* eslint-disable regexp/no-unused-capturing-group */
/* eslint-disable style/indent */
import '../types/context.js';
import {
  CONST,
  CUSTOM_COMMAND,
  CUSTOM_COMMAND_DESCRIPTION,
  DATABASE,
  ENV,
  ENV_KEY_MAPPER,
  PLUGINS_COMMAND,
  PLUGINS_COMMAND_DESCRIPTION,
  mergeEnvironment,
} from '../config/env.js';
import {
  chatModelKey,
  currentChatModel,
  currentImageModel,
  customInfo,
  imageModelKey,
  loadChatLLM,
  loadImageGen,
} from '../agent/agents.js';
import { trimUserConfig } from '../config/context.js';
import {
  TemplateOutputTypeHTML,
  TemplateOutputTypeImage,
  TemplateOutputTypeMarkdown,
  TemplateOutputTypeMarkdownV2,
  TemplateOutputTypeText,
} from '../types/template.js';
import { executeRequest, formatInput } from '../plugins/template.js';
import { requestText2Image } from '../agent/imagerequest.js';
import {
  sendMessageToTelegramWithContext,
  sendPhotoToTelegramWithContext,
  setMyCommands,
} from './telegram.js';
import { chatWithLLM } from './agent.js';
import { getChatRoleWithContext } from './utils.js';
import { sendTelegramMessage } from './message.js';

const commandAuthCheck = {
  default(chatType) {
    if (CONST.GROUP_TYPES.includes(chatType)) {
      return ['administrator', 'creator'];
    }
    return null;
  },
  shareModeGroup(chatType) {
    if (CONST.GROUP_TYPES.includes(chatType)) {
      // 每个人在群里有上下文的时候，不限制
      if (!ENV.GROUP_CHAT_BOT_SHARE_MODE) {
        return false;
      }
      return ['administrator', 'creator'];
    }
    return null;
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

/**
 *
 * @callback CommandFunction
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */

/**
 * @callback AuthCheckFunction
 * @param {string} chatType
 * @returns {string[] | null}
 */

/**
 * @typedef {object} CommandHandler
 * @property {string} scopes - 权限范围
 * @property {CommandFunction} fn - 处理函数
 * @property {AuthCheckFunction} [needAuth] - 权限检查函数
 */

/**
 * @type {{[key: string]: CommandHandler}}
 */
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
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandGenerateImg(message, command, subcommand, context) {
  if (!subcommand.trim()) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.img, 'tip');
  }
  try {
    const resp = await requestText2Image(context, { message: subcommand });
    if (!resp.ok) {
      console.error(resp.statusText);
      return sendMessageToTelegramWithContext(context)(`ERROR: ${resp.statusText} ${await resp.text()}`);
    }
  } catch (e) {
    console.error(e.message);
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /help 获取帮助信息
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandGetHelp(message, command, subcommand, context) {
  let helpMsg = `${ENV.I18N.command.help.summary}\n`;
  helpMsg += Object.keys(commandHandlers)
    .map(key => `${key}：${ENV.I18N.command.help[key.substring(1)]}`)
    .join('\n');
  helpMsg += `\n${Object.keys(CUSTOM_COMMAND)
    .filter(key => !!CUSTOM_COMMAND_DESCRIPTION[key])
    .map(key => `${key}：${CUSTOM_COMMAND_DESCRIPTION[key]}`)
    .join('\n')}`;
  helpMsg += Object.keys(PLUGINS_COMMAND)
    .filter(key => !!PLUGINS_COMMAND_DESCRIPTION[key])
    .map(key => `${key}：${PLUGINS_COMMAND_DESCRIPTION[key]}`)
    .join('\n');
  context.CURRENT_CHAT_CONTEXT.parse_mode = null;
  context.CURRENT_CHAT_CONTEXT.entities = [
    // { type: 'code', offset: 0, length: helpMsg.length },
    { type: 'blockquote', offset: 0, length: helpMsg.length },
  ];

  return sendMessageToTelegramWithContext(context)(helpMsg, 'tip');
}

/**
 * /new /start 新的会话
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandCreateNewChatContext(message, command, subcommand, context) {
  try {
    await DATABASE.delete(context.SHARE_CONTEXT.chatHistoryKey);

    const isNewCommand = command.startsWith('/new');
    const text = ENV.I18N.command.new.new_chat_start + (isNewCommand ? '' : `(${context.CURRENT_CHAT_CONTEXT.chat_id})`);

    // 非群组消息，显示回复按钮
    if (ENV.SHOW_REPLY_BUTTON && !CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)) {
      context.CURRENT_CHAT_CONTEXT.reply_markup = {
        keyboard: [[{ text: '/new' }, { text: '/redo' }]],
        selective: true,
        resize_keyboard: true,
        one_time_keyboard: false,
      };
    } else {
      context.CURRENT_CHAT_CONTEXT.reply_markup = {
        remove_keyboard: true,
        selective: true,
      };
    }

    return sendMessageToTelegramWithContext(context)(text, 'tip');
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /setenv 用户配置修改
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandUpdateUserConfig(message, command, subcommand, context, processUpdate = false) {
  if (command === '/mode') {
    if (subcommand === 'all') {
      const msg = `<pre>mode清单:   \n- ${Object.keys(context.USER_CONFIG.MODES).join('\n- ')}</pre>`;
      context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
      return sendMessageToTelegramWithContext(context)(msg, 'tip');
    } else if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.mode, 'tip');
    }
    if (!context.USER_CONFIG.MODES?.[subcommand]) {
      const msg = `mode \`${subcommand}\` not exist`;
      return sendMessageToTelegramWithContext(context)(msg, 'tip');
    }
    subcommand = `CURRENT_MODE=${subcommand}`;
  }
  const kv = subcommand.indexOf('=');
  if (kv === -1) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.setenv, 'tip');
  }
  let key = subcommand.slice(0, kv);
  const value = subcommand.slice(kv + 1);
  key = ENV_KEY_MAPPER[key] || key;
  if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
    return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`, 'tip');
  }
  if (!Object.keys(context.USER_CONFIG).includes(key)) {
    return sendMessageToTelegramWithContext(context)(`Key ${key} not found`, 'tip');
  }
  try {
    mergeEnvironment(context.USER_CONFIG, {
      [key]: value,
    });
    if (processUpdate) {
      if (key.endsWith('_MODEL')) {
        context._info.step.config('model', value);
      } else if (key === 'CURRENT_MODE') {
        context._info.step.config('mode', value);
      }
      return null;
    }
    context.USER_CONFIG.DEFINE_KEYS.push(key);
    context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
    console.log('Update user config: ', key, context.USER_CONFIG[key]);
    await DATABASE.put(context.SHARE_CONTEXT.configStoreKey, JSON.stringify(trimUserConfig(context.USER_CONFIG)));
    return sendMessageToTelegramWithContext(context)('Update user config success', 'tip');
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /setenvs 批量用户配置修改
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandUpdateUserConfigs(message, command, subcommand, context, processUpdate = false) {
  try {
    if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.setenvs, 'tip');
    }
    const values = JSON.parse(subcommand);
    const configKeys = Object.keys(context.USER_CONFIG);
    for (const ent of Object.entries(values)) {
      let [key, value] = ent;
      key = ENV_KEY_MAPPER[key] || key;
      if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
        return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`, 'tip');
      }
      if (!configKeys.includes(key)) {
        return sendMessageToTelegramWithContext(context)(`Key ${key} not found`, 'tip');
      }
      mergeEnvironment(context.USER_CONFIG, {
        [key]: value,
      });
      if (processUpdate) {
        if (key.endsWith('_MODEL')) {
          context._info.step.config('model', value);
        } else if (key === 'CURRENT_MODE') {
          context._info.step.config('mode', value);
        }
        continue;
      }
      context.USER_CONFIG.DEFINE_KEYS.push(key);
      console.log('Update user config: ', key, context.USER_CONFIG[key]);
    }
    if (processUpdate) {
      return null;
    }

    context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
    await DATABASE.put(
      context.SHARE_CONTEXT.configStoreKey,
      JSON.stringify(trimUserConfig(trimUserConfig(context.USER_CONFIG))),
    );
    return sendMessageToTelegramWithContext(context)('Update user config success', 'tip');
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
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
      return sendMessageToTelegramWithContext(context)(`\`\`\`plaintext\n${ENV.I18N.command.detail.set}\n\`\`\``, 'tip');
    }
    const keys = Object.fromEntries(context.USER_CONFIG.MAPPING_KEY.split('|').map(k => k.split(':')));
    if (keys['-u']) {
      delete keys['-u'];
    }
    const values = Object.fromEntries(context.USER_CONFIG.MAPPING_VALUE.split('|').map(k => k.split(':')));
    const updateTagReg = /\s+-u(\s+|$)/;
    const needUpdate = updateTagReg.test(subcommand);
    subcommand = subcommand.replace(updateTagReg, '$1');

    const msgCommand = subcommand.matchAll(/(-\w+)\s+(.*?)(\s+|$)/g);
    let msg = '';
    let hasKey = false;
    if (context.USER_CONFIG.AI_PROVIDER === 'auto') {
      context.USER_CONFIG.AI_PROVIDER = 'openai';
    }

    for (const [, k, v] of msgCommand) {
      let key = keys[k];
      let value = values[v];
      if (key) {
        if (ENV.LOCK_USER_CONFIG_KEYS.includes(key)) {
          return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`, 'tip');
        }
        const role_perfix = '~';
        switch (key) {
          case 'SYSTEM_INIT_MESSAGE':
            if (v?.startsWith(role_perfix)) {
              value = ENV.PROMPT[v.substring(1)];
              if (!value) {
                msg += `>\`${v} is not exist, will use default prompt\`\n`;
                value = ENV.I18N?.env?.system_init_message || 'You are a helpful assistant';
                // continue;
              } // else context._info.step.config('prompt', v.substring(1));
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
              return sendMessageToTelegramWithContext(context)(`mode ${v} is not exist`, 'tip');
            }
            context._info.config('mode', v);
            break;
          case 'USE_TOOLS':
            if (v === 'on') {
              value = Object.keys(ENV.TOOLS);
            } else if (v === 'off') {
              value = [];
            }
            break;
          default:
            break;
        }

        if (!Object.keys(context.USER_CONFIG).includes(key)) {
          return sendMessageToTelegramWithContext(context)(`Key ${key} not found`, 'tip');
        }
        context.USER_CONFIG[key] = value ?? v;
        context.USER_CONFIG.DEFINE_KEYS.push(key);
        console.log(`/set ${key || 'unknown'} ${(JSON.stringify(value) || v).substring(0, 100)}`);
      } else {
        return sendMessageToTelegramWithContext(context)(`Mapping Key ${k} is not exist`, 'tip');
      }
      if (!hasKey)
        hasKey = true;
    }
    if (needUpdate && hasKey) {
      context.USER_CONFIG.DEFINE_KEYS = Array.from(new Set(context.USER_CONFIG.DEFINE_KEYS));
      await DATABASE.put(
        context.SHARE_CONTEXT.configStoreKey,
        JSON.stringify(trimUserConfig(trimUserConfig(context.USER_CONFIG))),
      );
      msg += 'Update user config success';
    }
    if (msg)
      await sendMessageToTelegramWithContext(context)(msg, 'tip');
    return null;
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /delenv 用户配置修改
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandDeleteUserConfig(message, command, subcommand, context) {
  if (!subcommand) {
    return sendMessageToTelegramWithContext(context)(ENV.I18N.command.help.delenv, 'tip');
  }
  if (ENV.LOCK_USER_CONFIG_KEYS.includes(subcommand)) {
    const msg = `Key ${subcommand} is locked`;
    return sendMessageToTelegramWithContext(context)(msg, 'tip');
  }
  try {
    context.USER_CONFIG[subcommand] = null;
    context.USER_CONFIG.DEFINE_KEYS = context.USER_CONFIG.DEFINE_KEYS.filter(key => key !== subcommand);
    await DATABASE.put(
      context.SHARE_CONTEXT.configStoreKey,
      JSON.stringify(trimUserConfig(context.USER_CONFIG)),
    );
    return sendMessageToTelegramWithContext(context)('Delete user config success', 'tip');
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /clearenv 清空用户配置
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandClearUserConfig(message, command, subcommand, context) {
  try {
    if (subcommand.trim() !== 'true') {
      return sendMessageToTelegramWithContext(context)('Please sure that you want clear all config, send `/clearenv true`', 'tip');
    }
    await DATABASE.put(
      context.SHARE_CONTEXT.configStoreKey,
      JSON.stringify({}),
    );
    return sendMessageToTelegramWithContext(context)('Clear user config success', 'tip');
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /version 获得更新信息
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandFetchUpdate(message, command, subcommand, context) {
  const current = {
    ts: ENV.BUILD_TIMESTAMP,
    sha: ENV.BUILD_VERSION,
  };

  try {
    const info = `https://raw.githubusercontent.com/adolphnov/ChatGPT-Telegram-Workers/${ENV.UPDATE_BRANCH}/dist/buildinfo.json`;
    const online = await fetch(info).then(r => r.json());
    const timeFormat = (ts) => {
      return new Date(ts * 1000).toLocaleString('en-US', {});
    };
    if (current.ts < online.ts) {
      return sendMessageToTelegramWithContext(context)(`New version detected: ${online.sha}(${timeFormat(online.ts)})\nCurrent version: ${current.sha}(${timeFormat(current.ts)})`, 'tip');
    } else {
      return sendMessageToTelegramWithContext(context)(`Current version: ${current.sha}(${timeFormat(current.ts)}) is up to date`, 'tip');
    }
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * /system 获得系统信息
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandSystem(message, command, subcommand, context) {
  const chatAgent = loadChatLLM(context)?.name;
  const imageAgent = loadImageGen(context)?.name;
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
  agent.IMAGE_MODEL = context.USER_CONFIG.IMAGE_MODEL;
  let msg = `<pre>AGENT: ${JSON.stringify(agent, null, 2)}\n` + `others: ${customInfo(context.USER_CONFIG)
    }` + '\n</pre>';
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
    msg = `<pre>\n${msg}`;
    msg += `USER_CONFIG: ${JSON.stringify(config, null, 2)}\n`;
    msg += `CHAT_CONTEXT: ${JSON.stringify(context.CURRENT_CHAT_CONTEXT, null, 2)}\n`;
    msg += `SHARE_CONTEXT: ${JSON.stringify(shareCtx, null, 2)}\n`;
    msg += '</pre>';
  }
  context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
  return sendMessageToTelegramWithContext(context)(msg, 'tip');
}

/**
 * /redo 重新生成上一条消息
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
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
    return { history: historyCopy, message: nextText };
  };
  const result = await chatWithLLM({ message: null }, context, mf);
  return sendMessageToTelegramWithContext(context)(result.text);
}

/**
 * /echo 回显消息
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} subcommand
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function commandEcho(message, command, subcommand, context) {
  let msg = '<pre>';
  msg += JSON.stringify({ message }, null, 2);
  msg += '</pre>';
  context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
  return sendMessageToTelegramWithContext(context)(msg, 'tip');
}

/**
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} raw
 * @param {CommandHandler} handler
 * @param {ContextType} context
 * @returns {Promise<Response|*>}
 */
async function handleSystemCommand(message, command, raw, handler, context) {
  try {
    const commandLine = /^.*(\n|$)/.exec(message.text)[0];
    message.text = message.text.substring(commandLine.length);
    // 如果存在权限条件
    if (handler.needAuth) {
      const roleList = handler.needAuth(context.SHARE_CONTEXT.chatType);
      if (roleList) {
        // 获取身份并判断
        const chatRole = await getChatRoleWithContext(context);
        if (chatRole === null) {
          return sendMessageToTelegramWithContext(context)('ERROR: Get chat role failed');
        }
        if (!roleList.includes(chatRole)) {
          return sendMessageToTelegramWithContext(context)(`ERROR: Permission denied, need ${roleList.join(' or ')}`);
        }
      }
    }
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`);
  }
  const subcommand = raw.substring(command.length).trim();
  try {
    const result = await handler.fn(message, command, subcommand, context);
    console.log(`[DONE] Command: ${command} ${subcommand}`);
    if (result instanceof Response)
      return result;
    if (message.text.length === 0)
      return new Response('None question');
    if (message.text.startsWith('/'))
      return sendMessageToTelegramWithContext(context)(`Oops, it's not a command`, 'tip');
    return null;
  } catch (e) {
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}

/**
 * @param {TelegramMessage} message
 * @param {string} command
 * @param {string} raw
 * @param {RequestTemplate} template
 * @param {ContextType} context
 * @returns {Promise<Response|*>}
 */
async function handlePluginCommand(message, command, raw, template, context) {
  try {
    const subcommand = raw.substring(command.length).trim();
    const DATA = formatInput(subcommand, template.input?.type);
    const { type, content } = await executeRequest(template, {
      DATA,
      ENV: ENV.PLUGINS_ENV,
    });
    if (type === TemplateOutputTypeImage) {
      return sendPhotoToTelegramWithContext(context)(content);
    }
    switch (type) {
      case TemplateOutputTypeHTML:
        context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
        break;
      case TemplateOutputTypeMarkdown:
        context.CURRENT_CHAT_CONTEXT.parse_mode = 'Markdown';
        break;
      case TemplateOutputTypeMarkdownV2:
        context.CURRENT_CHAT_CONTEXT.parse_mode = 'MarkdownV2';
        break;
      case TemplateOutputTypeText:
      default:
        context.CURRENT_CHAT_CONTEXT.parse_mode = null;
        break;
    }
    return sendMessageToTelegramWithContext(context)(content);
  } catch (e) {
    const help = PLUGINS_COMMAND_DESCRIPTION[command];
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}\n${help}`);
  }
}

/**
 * 注入命令处理器
 */
function injectCommandHandlerIfNeed() {
  if (ENV.DEV_MODE) {
    commandHandlers['/echo'] = {
      help: '[DEBUG ONLY] echo message',
      scopes: ['all_private_chats', 'all_chat_administrators'],
      fn: commandEcho,
      needAuth: commandAuthCheck.default,
    };
  }
}
/**
 * 处理命令消息
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
export async function handleCommandMessage(message, context) {
  injectCommandHandlerIfNeed();
  // 触发自定义命令 替换为对应的命令
  const customKey = Object.keys(CUSTOM_COMMAND).find(k => message.text === k || message.text.startsWith(`${k} `));
  if (customKey) {
    message.text = message.text.replace(customKey, CUSTOM_COMMAND[customKey]);
  }
  const text = message.text;
  for (const key in PLUGINS_COMMAND) {
    if (text === key || text.startsWith(`${key} `)) {
      let template = PLUGINS_COMMAND[key].trim();
      if (template.startsWith('http')) {
        template = await fetch(template).then(r => r.text());
      }
      // 由于插值位置较多，直接检索整个模板是否包含占位符
      if (key.trim() === text.trim() && (template.includes('{{DATA}}'))) {
        return sendMessageToTelegramWithContext(context)(`ERROR: ${PLUGINS_COMMAND_DESCRIPTION[key] || 'Please input something'}`, 'tip');
      }
      return await handlePluginCommand(message, key, text, JSON.parse(template), context);
    }
  }
  for (const key in commandHandlers) {
    if (text === key || text.startsWith(`${key} `)) {
      const command = commandHandlers[key];
      return await handleSystemCommand(message, key, text, command, context);
    }
  }
  return null;
}

/**
 * 绑定命令到Telegram
 * @param {string} token
 * @returns {Promise<object>}
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
    const body = {
      commands: scopeCommandMap[scope].map(command => ({
        command,
        description: ENV.I18N.command.help[command.substring(1)] || '',
      })),
      scope: {
        type: scope,
      },
    };
    result[scope] = await setMyCommands(body, token).then(res => res.json());
  }
  return {
    ok: true,
    result,
  };
}

/**
 * 获取所有命令的描述
 * @returns {{description: *, command: *}[]}
 */
export function commandsDocument() {
  return Object.keys(commandHandlers).map((key) => {
    return {
      command: key,
      description: ENV.I18N.command.help[key.substring(1)],
    };
  });
}
