import { CONST, ENV } from '../config/env.js';
import { escape } from '../utils/md2tgmd.js';
import '../types/context.js';
import '../types/telegram.js';

// Telegram函数
// 1. 需要判断请求状态的返回Promise<Response>
// 2. 无需判断请求结果的返回Promise<Response>
// 3. 有具体数据处理需求的返回具体数据类型的Promise
// 4. 默认返回Promise<Response>

/**
 * @param {string} method
 * @param {string} token
 * @param {object} body
 * @returns {Promise<Response>}
 */
async function sendTelegramRequest(method, token, body = null) {
  const headers = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${ENV.TELEGRAM_API_DOMAIN}/bot${token}/${method}`, {
    method: 'POST',
    headers,
    body: body && (body instanceof FormData ? body : JSON.stringify(body)),
  });
}

/**
 * @param {string} message
 * @param {string} token
 * @param {object} context
 * @returns {Promise<Response>}
 */
async function sendMessage(message, token, context) {
  const body = {
    text: message,
  };
  for (const key of Object.keys(context)) {
    if (context[key] !== undefined && context[key] !== null) {
      body[key] = context[key];
    }
  }
  let method = 'sendMessage';
  if (context?.message_id) {
    method = 'editMessageText';
  }
  return sendTelegramRequest(method, token, body);
}

/**
 * @param {string} message
 * @param {string} token
 * @param {CurrentChatContextType} context
 * @returns {Promise<Response>}
 */
export async function sendMessageToTelegram(message, token, context, _info, type) {
  const chatContext = {
    ...context,
    message_id: Array.isArray(context.message_id) ? 0 : context.message_id,
  };
  const limit = 4000;
  const origin_msg = message;
  let info = '';
  const escapeContent = (parse_mode = chatContext?.parse_mode) => {
    if ((!_info || _info?.steps?.length === 0 || type === 'tip') && parse_mode !== 'MarkdownV2')
      return;
    info = _info.is_concurrent ? '' : _info.step?.message_title || '';
    if ((!_info.isLastStep && _info.steps.length !== 0 && parse_mode !== null) || _info.is_concurrent || origin_msg.length > limit) {
      chatContext.parse_mode = null;
      message = (info && (`${info}\n\n`)) + origin_msg;
      chatContext.entities = [
        { type: 'code', offset: 0, length: message.length },
        { type: 'blockquote', offset: 0, length: message.length },
      ];
    } else if (parse_mode === 'MarkdownV2') {
      info &&= (`>\`${info}\`\n\n`);
      message = info + escape(origin_msg);
    } else if (parse_mode === null) {
      message = (info && (`${info}\n`)) + origin_msg;
      chatContext.entities = [
        { type: 'code', offset: 0, length: info.length },
        { type: 'blockquote', offset: 0, length: info.length },
      ];
    }
  };
  if (message.length <= limit) {
    escapeContent();
    const resp = await sendMessage(message, token, chatContext);
    if (resp.status === 200) {
      return resp;
    } else {
      chatContext.parse_mode = null;
      context.parse_mode = null;
      info = _info?.message_title;
      message = info ? `${info}\n\n${origin_msg}` : origin_msg;
      return await sendMessage(message, token, chatContext);
    }
  }
  chatContext.parse_mode = null;
  info = _info?.message_title;
  message = info && `${info}\n\n${origin_msg}`;
  if (!Array.isArray(context.message_id)) {
    context.message_id = [context.message_id];
  }
  let msgIndex = 0;
  let last_resp = null;

  for (let i = 0; i < message.length; i += limit) {
    chatContext.message_id = context.message_id[msgIndex];
    msgIndex += 1;

    // 跳过二次发送中间消息，防止bad request
    if (msgIndex > 1 && context.message_id[msgIndex] && i + limit < message.length) {
      continue;
    }
    // 当隐藏INFO与TOKEN信息，跳过二次发送头部消息
    if (msgIndex == 1 && context.message_id.length > 1 && !context.USER_CONFIG.ENABLE_SHOWINFO && !context.USER_CONFIG.ENABLE_SHOWTOKEN) {
      continue;
    }

    const msg = message.slice(i, Math.min(i + limit, message.length));
    chatContext.entities = [
      { type: 'code', offset: 0, length: msg.length },
      { type: 'blockquote', offset: 0, length: msg.length },
    ];

    const resp = await sendMessage(msg, token, chatContext);
    if (resp.status == 429) {
      return resp;
    } else if (resp.status !== 200) {
      console.log(`[ERROR] ${await resp.text()}`);
    }
    if (msgIndex == 1) {
      continue;
    }
    if (!chatContext.message_id && resp.status == 200) {
      last_resp = resp.clone();
      const message_id = (await resp.json()).result?.message_id;
      context.message_id.push(message_id);
    }
  }
  return last_resp;
}

/**
 * @param {ContextType} context
 * @returns {function(string): Promise<Response>}
 */
export function sendMessageToTelegramWithContext(context) {
  return async (message, msgType = 'chat') => {
    const resp = await sendMessageToTelegram(
      message,
      context.SHARE_CONTEXT.currentBotToken,
      context.CURRENT_CHAT_CONTEXT,
      context._info,
      msgType,
    );
    if (!resp.ok)
      return resp;
    await checkIsNeedTagIds(context, msgType, resp.clone());
    return resp;
  };
}

/**
 * @param {ContextType} context
 * @returns {function(string): Promise<Response>}
 */
export function deleteMessageFromTelegramWithContext(context) {
  return async (messageId) => {
    const body = {
      chat_id: context.CURRENT_CHAT_CONTEXT.chat_id,
      message_id: messageId,
    };
    return sendTelegramRequest('deleteMessage', context.SHARE_CONTEXT.currentBotToken, body);
  };
}

/**
 * 批量删除Telegram消息
 * @param {*} chat_id
 * @param {*} token
 * @param {*} message_ids
 * @return {*}
 */
export async function deleteMessagesFromTelegram(chat_id, token, message_ids) {
  return sendTelegramRequest('deleteMessages', token, { chat_id, message_ids });
}

/**
 * 发送图片消息到Telegram
 * @param {string | Blob} photo
 * @param {string} token
 * @param {CurrentChatContextType} context
 * @returns {Promise<Response>}
 */
export async function sendPhotoToTelegram(photo_obj, token, context, _info) {
  try {
    const photo = photo_obj?.url?.[0] || photo_obj;
    if (typeof photo === 'string') {
      const body = {
        photo,
      };
      body.parse_mode = 'MarkdownV2';
      let info = _info?.step?.message_title || '';
      if (photo_obj?.text) {
        info = (info ? `${info}\n\n` : '') + photo_obj.text;
      }
      body.caption = '';
      if (info) {
        body.caption += `>\`${escape(info)}\``;
      }
      body.caption += `\n[原始图片](${photo})`;

      for (const key of Object.keys(context)) {
        if (context[key] !== undefined && context[key] !== null) {
          body[key] = context[key];
        }
      }
      return sendTelegramRequest('sendPhoto', token, body);
    } else {
      const body = new FormData();
      body.append('photo', photo, 'photo.png');
      for (const key of Object.keys(context)) {
        if (context[key] !== undefined && context[key] !== null) {
          body.append(key, `${context[key]}`);
        }
      }
      return sendTelegramRequest('sendPhoto', token, body);
    }
  } catch (e) {
    console.error(e);
  }
}

/**
 * @param {ContextType} context
 * @returns {function(string): Promise<Response>}
 */
export function sendPhotoToTelegramWithContext(context) {
  return async (img_info, msgType = 'chat') => {
    const resp = await sendPhotoToTelegram(
      img_info,
      context.SHARE_CONTEXT.currentBotToken,
      context.CURRENT_CHAT_CONTEXT,
      context._info,
    );
    if (!resp.ok) {
      console.error(await resp.clone().text());
      return resp;
    }
    await checkIsNeedTagIds(context, msgType, resp);
    return resp;
  };
}

/**
 * 发送包含多个文件链接的消息到Telegram
 * @param {string | Blob} photo
 * @param {string} token
 * @param {CurrentChatContextType} context
 * @returns {Promise<Response>}
 */
export async function sendMediaGroupToTelegram(mediaGroup, token, context, _info) {
  const supported_type = ['photo', 'audio', 'document', 'video'];
  const media_type = mediaGroup.type;

  if (!supported_type.includes(media_type)) {
    throw new Error(`unsupported media type: ${mediaGroup.type}`);
  }

  const body = {
    media: mediaGroup.url.map(i => ({ type: media_type, media: i })),
    chat_id: context.chat_id,
  };

  let info = _info?.step.message_title;
  if (mediaGroup.text) {
    info += `\n\n${mediaGroup.text}`;
  }

  body.media[0].caption = info;
  body.media[0].caption_entities = [
    { type: 'code', offset: 0, length: info.length },
    { type: 'blockquote', offset: 0, length: info.length },
  ];

  return sendTelegramRequest('sendMediaGroup', token, body);
}

/**
 * @param {ContextType} context
 * @returns {function(string): Promise<Response>}
 */
export function sendMediaGroupToTelegramWithContext(context) {
  return async (mediaGroup, msgType = 'chat') => {
    const resp = await sendMediaGroupToTelegram(
      mediaGroup,
      context.SHARE_CONTEXT.currentBotToken,
      context.CURRENT_CHAT_CONTEXT,
      context._info,
    );
    await checkIsNeedTagIds(context, msgType, resp);
    return resp;
  };
}

/**
 * 发送聊天动作到TG
 * @param {string} action
 * @param {string} token
 * @param {string | number} chatId
 * @returns {Promise<Response>}
 */
async function sendChatActionToTelegram(action, token, chatId) {
  return sendTelegramRequest('sendChatAction', token, {
    chat_id: chatId,
    action,
  });
}

/**
 * @param {ContextType} context
 * @returns {function(string): Promise<Response>}
 */
export function sendChatActionToTelegramWithContext(context) {
  return (action) => {
    return sendChatActionToTelegram(action, context.SHARE_CONTEXT.currentBotToken, context.CURRENT_CHAT_CONTEXT.chat_id);
  };
}

/**
 * 绑定WebHook
 * @param {string} token
 * @param {string} url
 * @returnss {Promise<Response>}
 */
export async function bindTelegramWebHook(token, url) {
  return sendTelegramRequest('setWebhook', token, { url });
}

/**
 * 删除WebHook
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function deleteTelegramWebHook(token) {
  return sendTelegramRequest('deleteWebhook', token);
}

/**
 * 获取更新
 * @param {string} token
 * @param {number} offset
 * @returns {Promise<{result: TelegramWebhookRequest[]}>}
 */
export async function getTelegramUpdates(token, offset) {
  return sendTelegramRequest('getUpdates', token, { offset })
    .then(res => res.json());
}

/**
 * 获取群组管理员信息
 * @param {string | number} chatId
 * @param {string} token
 * @returns {Promise<{result: object[]}>}
 */
export async function getChatAdministrators(chatId, token) {
  return sendTelegramRequest('getChatAdministrators', token, { chat_id: chatId })
    .then(res => res.json()).catch(() => null);
}

/**
 * 获取机器人名称
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function getBotName(token) {
  const { result: { username } } = await sendTelegramRequest('getMe', token)
    .then(res => res.json());
  return username;
}

/**
 * 获取文件链接
 * @param {string} fileId
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function getFileLink(fileId, token) {
  try {
    const { result: { file_path } } = await sendTelegramRequest('getFile', token, { file_id: fileId })
      .then(res => res.json());
    return `https://api.telegram.org/file/bot${token}/${file_path}`;
  } catch (e) {
    console.error(e);
  }
  return '';
}

/**
 * @param {any} config
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function setMyCommands(config, token) {
  return sendTelegramRequest('setMyCommands', token, config);
}

/**
 * @description: 标记消息id
 * @param {*} context
 * @param {*} msgType
 * @param {*} resp
 * @return {*}
 */
async function checkIsNeedTagIds(context, msgType, resp) {
  const { sentMessageIds, chatType } = context.SHARE_CONTEXT;
  let message_id = null;
  if (sentMessageIds) {
    const clone_resp = await resp.json();
    if (Array.isArray(clone_resp.result)) {
      message_id = clone_resp?.result?.map(i => i.message_id);
    } else {
      message_id = [clone_resp?.result?.message_id];
    }
    if (!message_id) {
      console.error(JSON.stringify(clone_resp));
      return;
    }
    const isGroup = CONST.GROUP_TYPES.includes(chatType);
    const isNeedTag
      = (isGroup && ENV.SCHEDULE_GROUP_DELETE_TYPE.includes(msgType))
      || (!isGroup && ENV.SCHEDULE_PRIVATE_DELETE_TYPE.includes(msgType));
    if (isNeedTag) {
      // 标记消息id
      sentMessageIds.add(...message_id);
      if (msgType === 'tip' && !isGroup) {
        // 删除发送人的消息
        sentMessageIds.add(context.SHARE_CONTEXT.messageId);
      }
    }
  }
}
