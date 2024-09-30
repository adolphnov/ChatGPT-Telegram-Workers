/* eslint-disable style/indent */
import { CONST, DATABASE, ENV } from '../config/env.js';
import { Context } from '../config/context.js';
import { errorToString } from '../utils/utils.js';
import { getBotName, sendMessageToTelegramWithContext, sendChatActionToTelegramWithContext, sendPhotoToTelegramWithContext, sendMediaGroupToTelegramWithContext } from './telegram.js';
import { handleCommandMessage } from './command.js';
import { MiddleInfo, getTelegramFileUrl } from "../config/middle.js";
import { requestI2IHander, requestText2Image } from "../agent/imagerequest.js";
import { sendTextMessageHandler, chatWithLLM } from "./agent.js";
import { chatViaFileWithLLM } from "../agent/chat.js";


import '../types/telegram.js';
import { checkMention } from './utils.js';

/**
 * 初始化聊天上下文
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgInitChatContext(message, context) {
    await context.initContext(message);
    return null;
}

/**
 * 保存最后一条消息
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgSaveLastMessage(message, context) {
    if (ENV.DEBUG_MODE) {
        const lastMessageKey = `last_message:${context.SHARE_CONTEXT.chatHistoryKey}`;
        await DATABASE.put(lastMessageKey, JSON.stringify(message), { expirationTtl: 3600 });
    }
    return null;
}

/**
 * 忽略旧的消息
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgIgnoreOldMessage(message, context) {
    if (ENV.SAFE_MODE) {
        let idList = [];
        try {
          idList = JSON.parse((await DATABASE.get(context.SHARE_CONTEXT.chatLastMessageIdKey)) || '[]');
        } catch (e) {
            console.error(e);
        }
        // 保存最近的100条消息，如果存在则忽略，如果不存在则保存
        if (idList.includes(message.message_id)) {
          return new Response('Ignore old message', { status: 200 });
          
        } else {
            idList.push(message.message_id);
            if (idList.length > 100) {
                idList.shift();
            }
            await DATABASE.put(context.SHARE_CONTEXT.chatLastMessageIdKey, JSON.stringify(idList));
        }
    }
    return null;
}

/**
 * 检查环境变量是否设置
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgCheckEnvIsReady(message, context) {
    if (!DATABASE) {
        return sendMessageToTelegramWithContext(context)('DATABASE Not Set', 'tip');
    }
    return null;
}

/**
 * 过滤非白名单用户
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgFilterWhiteList(message, context) {
    if (ENV.I_AM_A_GENEROUS_PERSON) {
        return null;
    }
    // 判断私聊消息
    if (context.SHARE_CONTEXT.chatType === 'private') {
    // 白名单判断
        if (!ENV.CHAT_WHITE_LIST.includes(`${context.CURRENT_CHAT_CONTEXT.chat_id}`)) {
            return sendMessageToTelegramWithContext(context)(
                `You are not in the white list, please contact the administrator to add you to the white list. Your chat_id: ${context.CURRENT_CHAT_CONTEXT.chat_id}`,
            );
        }
        return null;
    }

    // 判断群组消息
    if (CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)) {
    // 未打开群组机器人开关,直接忽略
        if (!ENV.GROUP_CHAT_BOT_ENABLE) {
            throw new Error('Not support');
        }
        // 白名单判断
        if (!ENV.CHAT_GROUP_WHITE_LIST.includes(`${context.CURRENT_CHAT_CONTEXT.chat_id}`)) {
            return sendMessageToTelegramWithContext(context)(
                `Your group are not in the white list, please contact the administrator to add you to the white list. Your chat_id: ${context.CURRENT_CHAT_CONTEXT.chat_id}`,
            );
        }
        return null;
    }
    return sendMessageToTelegramWithContext(context)(
        `Not support chat type: ${context.SHARE_CONTEXT.chatType}`,
    );
}

/**
 * 过滤不支持的消息
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
// eslint-disable-next-line unused-imports/no-unused-vars
async function msgFilterUnsupportedMessage(message, context) {
  if (message.text || (ENV.EXTRA_MESSAGE_CONTEXT && message.reply_to_message?.text)) {
    return null;
  }
  if (ENV.ENABLE_FILE && (message.voice || message.audio || message.photo || message.image || message.document)) {
    return null;
  }
  throw new Error("Unsupported message");
}

/** 
 * 处理私聊消息
 *  
 * @param {TelegramMessage} message
 * @param {Context} context
 * @return {Promise<Response>}
 */
async function msgHandlePrivateMessage(message, context) {
  if ('private' !== context.SHARE_CONTEXT.chatType) {
    return null;
  }
  // 非文本 和 非标题图片
  if (!message.text && !message.caption) {
    return null;
  }
  if (!message.text && !ENV.ENABLE_FILE) {
    return new Response('Non text message', { 'status': 200 });
  }
  // 聊天中简化命令
  const chatMsgKey = Object.keys(ENV.CHAT_MESSAGE_TRIGGER).find((key) =>
    (message?.text || message?.caption || '').startsWith(key),
  );
  if (chatMsgKey) {
    if (message.text) {
      message.text = message.text.replace(chatMsgKey, ENV.CHAT_MESSAGE_TRIGGER[chatMsgKey]);
    } else message.caption = message.caption.replace(chatMsgKey, ENV.CHAT_MESSAGE_TRIGGER[chatMsgKey]);
  }
  return null;
}

/**
 * 处理群消息
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgHandleGroupMessage(message, context) {
  // 非群组消息不作判断，交给下一个中间件处理
  if (!CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)) {
    return null;
  }

  // 处理群组消息，过滤掉AT部分
  let botName = context.SHARE_CONTEXT.currentBotName;
  if (!botName) {
    botName = await getBotName(context.SHARE_CONTEXT.currentBotToken);
    context.SHARE_CONTEXT.currentBotName = botName;
  }
  if (!botName) {
    throw new Error('Not set bot name');
  }

  // 检查替换词
  const chatMsgKey = Object.keys(ENV.CHAT_MESSAGE_TRIGGER).find((key) =>
    (message?.text || message?.caption || '').startsWith(key),
  );
  if (chatMsgKey) {
    let modifyType = '';
    if (message.text) {
      modifyType = 'text';
    } else modifyType = 'caption';
    message[modifyType] = message[modifyType].replace(chatMsgKey, ENV.CHAT_MESSAGE_TRIGGER[chatMsgKey]);
  }

  // 处理回复消息, 如果回复的是当前机器人的消息交给下一个中间件处理
  if (message.reply_to_message) {
    if (`${message.reply_to_message.from.id}` === context.SHARE_CONTEXT.currentBotId) {
      if (message.text.endsWith(`@${botName}`)) {
        message.text = message.text.substring(0, message.text.length - `@${botName}`.length);
      }
      return null;
    } else if (ENV.EXTRA_MESSAGE_CONTEXT) {
      context.SHARE_CONTEXT.extraMessageContext = message.reply_to_message;
    }
  }

  let isMention = false;
  // 检查text中是否有机器人的提及
  if (message.text && message.entities) {
    const res = checkMention(message.text, message.entities, botName, context.SHARE_CONTEXT.currentBotId);
    isMention = res.isMention;
    message.text = res.content.trim();
  }
  // 检查caption中是否有机器人的提及
  if (message.caption && message.caption_entities) {
    const res = checkMention(message.caption, message.caption_entities, botName, context.SHARE_CONTEXT.currentBotId);
    isMention = res.isMention || isMention;
    message.caption = res.content.trim();
  }

  if (!isMention && chatMsgKey) {
    // 触发关键词时调整为true
    isMention = true;
  }

  if (!isMention) {
    throw new Error('Not mention');
  }
  return null;
}



/**
 * 初始化用户配置 
 * @param {TelegramMessage} message
 * @param {Context} context
 * @return {Promise<Response>}
 */
async function msgInitUserConfig(message, context) {
    try {
      await context._initUserConfig(context.SHARE_CONTEXT.configStoreKey);
      const telegraphAccessTokenKey = context.SHARE_CONTEXT.telegraphAccessTokenKey;
      context.SHARE_CONTEXT.telegraphAccessToken = await DATABASE.get(telegraphAccessTokenKey);
      return null;
    } catch (e) {
      return sendMessageToTelegramWithContext(context)(e.message, 'tip');
    }
  }

/**
 * 忽略特定文本
 * 
 * @param {TelegramMessage} message 
 * @param {Context} context
 * @return {Promise<Response>}
 */
async function msgIgnoreSpecificMessage(message) {
    if (
      ENV.IGNORE_TEXT && message?.text?.startsWith(ENV.IGNORE_TEXT)
    ) {
      return new Response('ignore specific text', { status: 200 });
    }
    return null;
}
  

/**
 * 初始化中间信息
 * 
 * @param {TelegramMessage} message 
 * @param {Context} context
 * @return {Promise<Response>}
 */
async function msgInitMiddleInfo(message, context) {
  try {
    await MiddleInfo.initInfo(message, context);
    return null;
  } catch (e) {
    console.log(e.message);
    throw new Error('Can’t init info, please see the log for detail.');
  }
}



/**
 * 响应命令消息
 * @param {TelegramMessage} message
 * @param {ContextType} context
 * @returns {Promise<Response>}
 */
async function msgHandleCommand(message, context) {
    if (!message.text) {
    // 非文本消息不作处理
        return null;
    }
    return await handleCommandMessage(message, context);
}


/**
 * 与llm聊天
 * @param {TelegramMessage} message
 * @param {Context} context
 * @returns {Promise<Response>}
 */
async function msgChatWithLLM(message, context) {
  const is_concurrent = context._info.is_concurrent;
  if (context._info.file.type !== 'text') {
    context._info.file.url = await getTelegramFileUrl(context._info.file, context.SHARE_CONTEXT.currentBotToken);
  }
  const llmPromises = [];
  // 与LLM交互
  try {
    let result = null;
    for (let i = 0; i < context._info.chains.length; i++) {
      // 每个独立消息
      if (context.CURRENT_CHAT_CONTEXT.message_id && !ENV.HIDE_MIDDLE_MESSAGE) {
        context.CURRENT_CHAT_CONTEXT.message_id = null;
        context.SHARE_CONTEXT.telegraphPath = null;
      }
      context._info.initStep(i, result ?? context._info.file);
      const file = result ?? context._info.file;
      const params = { message: file.text, index: i };

      if (file.type !== 'text') {
        const file_urls = await getTelegramFileUrl(file, context.SHARE_CONTEXT.currentBotToken);
        if (file.type === 'image') {
          params.images = file_urls;
        } else params.files = { type: file.type, url: file_urls, raw: file.raw };
      }

      if (is_concurrent && i === 0 || !is_concurrent) await sendInitMessage(context);
      
      if (is_concurrent) {
        context.USER_CONFIG.ENABLE_SHOWTOKEN = false;
        llmPromises.push(chatLlmHander(context, params));
      } else {
          result = await chatLlmHander(context, params);
          if (result && result instanceof Response) {
            return result;
          }
        }
      }
    const results = await Promise.all(llmPromises);
    results.forEach((result, index) => {
      if (result.type === 'text') {
        context._info.steps[index].concurrent_content = result.text;
      }
    });
    if (is_concurrent && results.filter(i => i.type === 'text').length > 0) {
      if (context._info.nextEnableTime) {
        await new Promise(resolve => setTimeout(resolve, nextEnableTime - Date.now()));
        context._info.nextEnableTime = null;
      }
      await sendTextMessageHandler(context)(context._info.concurrent_content);
    }
    return new Response('success', { status: 200 });
  } catch (e) {
    console.error(e);
    return sendMessageToTelegramWithContext(context)(`ERROR: ${e.message}`, 'tip');
  }
}



/**
 * 
 * @param {Context} context
 * @param {string} chain_type
 * @param {object} params
 * @return {Promise<Response>}
 */
async function chatLlmHander(context, params) {
  const step = context._info.steps[params.index];
  const chain_type = step.chain_type;
  switch (chain_type) {
    case 'text:text':
    case 'image:text':
      return chatWithLLM(params, context);
    case 'text:image':
      return requestText2Image(context, params);
    case 'audio:text':
      return chatViaFileWithLLM(context, params);
    case 'image:image':
      return requestI2IHander(context, params);
    case 'audio:audio':
    case 'text:audio':
    default:
      return sendMessageToTelegramWithContext(context)('unsupported type', 'tip');
  }
}

/**
 * 
 * @param {Context} context
 * @return {Promise<Response>}
 */
export async function sendInitMessage(context) {
  try {
    const chain_type = context._info?.step?.chain_type || 'text:text';
    let text = '...',
      type = 'chat';
    if (['text:image', 'image:image'].includes(chain_type)) {
      return;
    }
    const parseMode = context.CURRENT_CHAT_CONTEXT.parse_mode;
    context.CURRENT_CHAT_CONTEXT.parse_mode = null;
    const msg = await sendMessageToTelegramWithContext(context)(text, type).then((r) => r.json());
    context.CURRENT_CHAT_CONTEXT.message_id = msg.result.message_id;
    context.CURRENT_CHAT_CONTEXT.parse_mode = parseMode;
    context.CURRENT_CHAT_CONTEXT.reply_markup = null;
  } catch (e) {
    console.error(e);
  }
}

export function sendTelegramMessage(context, file) {
  sendAction(context, file.type);
  switch (file.type) {
    case 'text':
      return sendTextMessageHandler(context)(file.text);
    case 'image':
      file.type = 'photo';
      if (file.url?.length > 1) {
        return sendMediaGroupToTelegramWithContext(context)(file);
      } else if (file.url?.length > 0 || file.raw?.length > 0) {
        return sendPhotoToTelegramWithContext(context)(file);
      }
    default:
      return sendMessageToTelegramWithContext(context)(`Not supported type`);
  }
}

function sendAction(context, type) {
  switch (type) {
    case 'text':
    default:
      setTimeout(() => sendChatActionToTelegramWithContext(context)('typing').catch(console.error), 0);
      break;
    case 'image':
      setTimeout(() => sendChatActionToTelegramWithContext(context)('upload_photo').catch(console.error), 0);
      break;
  }
}

/**
 * 加载真实TG消息
 * @param {TelegramWebhookRequest} body
 * @returns {TelegramMessage}
 */
function loadMessage(body) {
    if (body?.edited_message) {
        throw new Error('Ignore edited message');
    }
    if (body?.message) {
        return body?.message;
    } else {
        throw new Error('Invalid message');
    }
}

/**
 * @description: 
 * @param {TelegramMessage} message
 * @param {Context} context
 * @return {Promise<Response>}
 */
async function scheduledDeleteMessage(message, context) {
  const { sentMessageIds } = context.SHARE_CONTEXT;
  // 未记录消息
  if (!sentMessageIds || sentMessageIds.size === 0)
    return new Response('success', { status: 200 });

  const chatId = context.SHARE_CONTEXT.chatId;
  const botName = context.SHARE_CONTEXT.currentBotName;
  const scheduleDeteleKey = context.SHARE_CONTEXT.scheduleDeteleKey;
  const scheduledData = JSON.parse((await DATABASE.get(scheduleDeteleKey)) || '{}');
  if (!scheduledData[botName]) {
    scheduledData[botName] = {};
  }
  if (!scheduledData[botName][chatId]) {
    scheduledData[botName][chatId] = [];
  }
  const offsetInMillisenconds = ENV.EXPIRED_TIME * 60 * 1000;
  scheduledData[botName][chatId].push({
    id: [...sentMessageIds],
    ttl: Date.now() + offsetInMillisenconds,
  });
  
  await DATABASE.put(scheduleDeteleKey, JSON.stringify(scheduledData));
  console.log(`Record chat ${chatId}, message ids: ${[...sentMessageIds]}`);

  return new Response('success', { status: 200 });
}

/**
 * @description: 
 * @param {TelegramMessage} message
 * @param {Context} context
 * @return {Promise<Response>}
 */
async function msgTagNeedDelete(message, context) {
  return await scheduledDeleteMessage(message, context);
}

async function msgStoreWhiteListMessage(message, context) {
  if (ENV.STORE_MESSAGE_WHITELIST.includes(message.message.from.id) && ENV.STORE_MESSAGE_NUM > 0) {
    const storeMessageKey = context.SHARE_CONTEXT.storeMessageKey;
    const data = JSON.parse(await DATABASE.get(storeMessageKey) || '[]');
    data.push(await extractMessageType(message));
    if (data.length > ENV.STORE_MESSAGE_NUM) {
      data.splice(0, data.length - ENV.STORE_MESSAGE_NUM);
    }
    await DATABASE.put(storeMessageKey, JSON.stringify(data));
  }
  return new Response('ok');
}


/**
 * 处理消息
 * @param {string} token
 * @param {TelegramWebhookRequest} body
 * @returns {Promise<Response|null>}
 * @param {string} token
 * @param {TelegramWebhookRequest} body
 * @returns {Promise<Response|null>}
 */
export async function handleMessage(token, body) {
  const context = new Context();
  context.initTelegramContext(token);
  const message = loadMessage(body);

    // 中间件定义 function (message: TelegramMessage, context: Context): Promise<Response|null>
    // 1. 当函数抛出异常时，结束消息处理，返回异常信息
    // 2. 当函数返回 Response 对象时，结束消息处理，返回 Response 对象
    // 3. 当函数返回 null 时，继续下一个中间件处理

    // 消息处理中间件
    const handlers = [
      // 初始化聊天上下文: 生成chat_id, reply_to_message_id(群组消息), SHARE_CONTEXT
      msgInitChatContext,
      // 忽略特定文本
      msgIgnoreSpecificMessage,
      // 检查环境是否准备好: DATABASE
      msgCheckEnvIsReady,
      // 过滤非白名单用户
      msgFilterWhiteList,
      // 忽略旧消息
      msgIgnoreOldMessage,
      // DEBUG: 保存最后一条消息
      msgSaveLastMessage,
      // 过滤不支持的消息(抛出异常结束消息处理)
      msgFilterUnsupportedMessage,
      // 处理私人消息
      msgHandlePrivateMessage,
      // 处理群消息，判断是否需要响应此条消息
      msgHandleGroupMessage,
      // 初始化用户配置
      msgInitUserConfig,
      // 初始化基础中间信息
      msgInitMiddleInfo,
      // 处理命令消息
      msgHandleCommand,
      // 与llm聊天
      msgChatWithLLM,
    ];
  
    const exitHanders = [msgTagNeedDelete,msgStoreWhiteListMessage];

  for (const handler of handlers) {
        try {
          const result = await handler(message, context);
          if (result && result instanceof Response) {
              // return result;
              break;
            }
        } catch (e) {
            console.error(e);
            return new Response(errorToString(e), {status: 500});
        }
    }

    for (const handler of exitHanders) {
      try {
        const result = await handler(message, context);
          if (result && result instanceof Response) {
            return result;
          }
      } catch (e) {
          console.error(e);
          return new Response(errorToString(e), {status: 500});
      }
    }
    return null;
}
