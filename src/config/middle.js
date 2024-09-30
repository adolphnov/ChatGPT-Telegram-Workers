import { ENV } from './env.js';
import { getFileLink } from '../telegram/telegram.js';
import { uploadImageToTelegraph } from '../utils/image.js';

/**
 * 提取消息类型与文件url
 *
 * @param {TelegramMessage} message
 * @returns {Promise<MsgInfo>}
 */
async function extractMessageType(message, currentBotId) {
  let msg = message;
  const acceptMsgType = ENV.ENABLE_FILE ? ['document', 'photo', 'image', 'voice', 'audio', 'text'] : ['text'];
  let msgType = acceptMsgType.find((key) => key in msg);
  let message_text = message.text ?? message.caption;

  if (ENV.EXTRA_MESSAGE_CONTEXT && (message.reply_to_message?.text || message.reply_to_message?.caption) && message.reply_to_message?.from?.id !== +currentBotId) {
    message_text =
      '> ' + (message.reply_to_message.text || '') + (message.reply_to_message?.caption || '') + '\n' + message_text;
  }

  if (msgType === 'text' && message.reply_to_message && ENV.EXTRA_MESSAGE_CONTEXT) {
    // 仅在开启EXTRA_MESSAGE_CONTEXT 且 触发对象消息类型为text时尝试读取reply_message的文件
    const reply_message = message.reply_to_message;
    const reply_type = acceptMsgType.find((key) => key in reply_message);
    if (reply_type && reply_type !== 'text') {
      msg = reply_message;
      msgType = reply_type;
    }
  }

  if (msgType === 'text') {
    return {
      text: message_text,
      type: 'text',
    };
  }

  let fileType = null;

  switch (msgType) {
    case 'photo':
      fileType = 'image';
      break;
    case 'voice':
      fileType = 'audio';
      break;
    case 'document':
      if (msg.document.mime_type.match(/image/)) {
        fileType = 'image';
      } else if (msg.document.mime_type.match(/audio/)) {
        fileType = 'audio';
      }
      break;
    default:
      throw new Error('unsupported type');
  }

  let file_id = null;
  if (msgType == 'photo') {
    let sizeIndex = 0;
    if (ENV.TELEGRAM_PHOTO_SIZE_OFFSET >= 0) {
      sizeIndex = ENV.TELEGRAM_PHOTO_SIZE_OFFSET;
    } else if (ENV.TELEGRAM_PHOTO_SIZE_OFFSET < 0) {
      sizeIndex = msg.photo.length + ENV.TELEGRAM_PHOTO_SIZE_OFFSET;
    }
    sizeIndex = Math.max(0, Math.min(sizeIndex, msg.photo.length - 1));
    file_id = msg.photo[sizeIndex].file_id;
  } else {
    file_id = msg[msgType]?.file_id || null;
  }

  return {
    type: fileType,
    id: file_id ? [file_id] : [],
    text: message_text,
  };
}


/**
 * @description: 通过id获取到最终url
 * @param {string[]} file_id
 * @return {*}
 */
export async function getTelegramFileUrl(file, botToken) {
  if (file?.url?.length > 0) return file.url;
  const { type, url } = file;
  const ids = file.id;
  if (ids.length === 0) {
    return url.length > 0 ? url : raw;
  }
  const getUrlPromise = [];
  for (const id of ids) {
    getUrlPromise.push(getFileLink(id, botToken));
  }
  let file_urls = (await Promise.all(getUrlPromise)).filter(Boolean);
  if (file_urls.length === 0) {
    throw new Error('file url get failed.');
  }

  if (ENV.TELEGRAPH_IMAGE_ENABLE && type === 'image') {
    const promises = [];
    for (const url of file_urls) {
      promises.push(uploadImageToTelegraph(url));
    }
    file_urls = await Promise.all(promises);
  }

  console.log('file url:\n' + file_urls.join('\n'));
  return file_urls;
}

/**
 * 下载文件
 * @return {Promise<Response>}
 */
export async function handleFile(file) {
  let { raw, url, type } = file;
  if (!raw?.[0] && !url?.[0]) throw new Error('cant get raw file.');
  
  const file_name = url[0].split('/').pop();
  if (!raw?.[0] && type !== 'image') {
    const file_resp = await fetch(url[0]);
    if (file_resp.status !== 200) {
      throw new Error(`Get file failed: ${await file_resp.text()}`);
    }
    raw = await file_resp.blob();
  }
  return { raw, file_name };
}

export class MiddleInfo {
  constructor(USER_CONFIG, msg_info) {
    this.chain_start_time = Date.now();
    const msgType = msg_info.type || 'text';
    const mode_detail = USER_CONFIG.MODES[USER_CONFIG.CURRENT_MODE]?.[msgType];
    this.is_concurrent = mode_detail?.type === 'concurrent';
    this.chains = mode_detail?.chains || [{}];
    this._bp_config = { ...USER_CONFIG }; // 备份用户配置
    this.file = {
      type: 'text',
      id: [],
      // url: [],
      // raw: [],
      text: '',
      ...msg_info,
    }; // 备份tg文件
    this.steps = [];
    this.index = -1;
    this.concurrent_stream = null;
  }
  config(name, value) {
    if (name === 'mode') {
      const mode_detail = this._bp_config.MODES[value]?.[this.file.type];
      this.chains = mode_detail?.chains || [{}];
      this.is_concurrent = mode_detail?.type === 'concurrent';
    }
  }
  initStep(index = 0, file_info = this.file) {
    this.index++;
    const step = new StepStructure();
    const chains_length = this.chains.length;
    let step_info = null;
    let file = this.file;
    if (this.is_concurrent) {
      step_info = '';
    } else {
      step_info = chains_length > 1 ? `${(index ?? this.index) + 1}/${chains_length}` : '';
      file = file_info;
    }
    this.steps.push(step.initInfo(this.chains[index ?? this.index], file, this._bp_config, step_info));
    
  }
  get isLastStep() {
    return this.is_concurrent || this.index + 1 === this.chains.length;
  }

  provider(index =  this.index) {
    if (this.steps[index].provider ) {
      return this._bp_config.PROVIDERS?.[this.step[index].provider];
    }
    return null;
  }
  get step() {
    return this.steps[this.steps.length - 1];
  }

  get concurrent_content() {
    return this.steps
      .map((step) => {
        return  '✱ '+ step.message_title + '\n' + step.concurrent_content;
      })
      .join('\n------\n');
  }



  static async initInfo(message, context) {
    const msg_info = await extractMessageType(message, context.SHARE_CONTEXT.currentBotId);
    context._info = new MiddleInfo(context.USER_CONFIG, msg_info);
  }
}

class StepStructure {
  chain_start_time = Date.now();
  chain_type = null;
  step_info = '';
  token_info = [];
  file = {
    type: 'text',
    id: [],
    url: [],
    raw: [],
    text: '',
  };
  call_info = '';
  agent = null;
  model = null;
  prompt = null;
  history = null;
  provider = null;
  show_info = null;
  tool = [];
  concurrent_content = '';

  config(name, value) {
    if (name === 'show_info') {
      this.show_info = value;
    }
  }

  setToken(prompt, complete) {
    this.token_info.push({
      prompt,
      complete,
    });
  }

  get hasFile() {
    return this.file.url.length > 0 || this.file.raw.length > 0 || this.file.id.length > 0;
  }

  updateStartTime() {
    this.chain_start_time = Date.now();
  }

  get message_title() {
    if (!this.model || !this.chain_start_time || !this.show_info) return '';
    const stepInfo = ENV.HIDE_MIDDLE_MESSAGE ? '' : this.step_info && `[STEP ${this.step_info}]\n`;
    const time = ((Date.now() - this.chain_start_time) / 1000).toFixed(1);
    let call_info = '';
    if (ENV.CALL_INFO) call_info = (this.call_info && this.call_info + '\n').replace('$$f_t$$', '');
    let info = stepInfo + call_info + `${this.model} ${time}s`;
    if (this.token_info && this.token_info.length > 0) {
      info += `\n${this.token_info.map(Object.values).join('|')}`;
    }
    return info;
  }



  setCallInfo(message, type = 'f_i') {
    if (type === 'f_t') {
      this.call_info = this.call_info.replace('$$f_t$$', 'f_t: ' + message);
    } else if (type === 'c_t') {
      this.call_info = (this.call_info && this.call_info + '\n') + `c_t: ${message} $$f_t$$`;
    } else if (type === 'f_i') {
      this.call_info = (this.call_info && this.call_info + '\n') + message;
    } else {
      this.call_info += '\n' + message;
    }
  }

  initInfo(chain, file_info, config, step_info = '') {
    this.file = { ...this.file, ...file_info };
    // chain type
    this.chain_type = chain.chain_type || `${this.file.type}:text`;
    this.step_info = step_info;

    let chatType = null;
    switch (this.chain_type) {
      case 'text:text':
        chatType = 'CHAT';
        break;
      case 'text:image':
        chatType = 'IMAGE';
        break;
      case 'audio:text':
        chatType = 'STT';
        break;
      case 'image:text':
        chatType = 'VISION';
        break;
      default:
        throw new Error('unsupport type');
    }

    // agent
    if ('IMAGE' === chatType) {
      this.agent = chain.agent || config.AI_IMAGE_PROVIDER;
    } else {
      this.agent = chain.agent || config.AI_PROVIDER;
    }

    let model_type = '';
    if (['deepseek', 'silicon'].includes(this.agent)) {
      model_type = `${chatType}_MODEL`;
    } else model_type = `${this.agent.toUpperCase()}_${chatType}_MODEL`;

    // model
    this.model =
      chain.model || config[model_type] || config[`OPENAI_${chatType}_MODEL`];

    // prompt
    if (chain.prompt) {
      this.prompt = ENV.PROMPT[chain.prompt] ?? chain.prompt;
    } else this.prompt = config.SYSTEM_INIT_MESSAGE;

    // provider
    this.provider = chain.provider;

    // history length
    this.history = chain.history ?? config.MAX_HISTORY_LENGTH;

    // show_info
    this.show_info = chain.show_info ?? config.ENABLE_SHOWINFO;

    // tool
    this.tool = chain.tool ?? config.USE_TOOLS;

    return this;
  }
}
