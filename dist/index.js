const prompts = { "dall-e": "根据我的描述，完善dalle的提示词，不要回复多余的信息","代码解释器": "你的任务是获取提供的代码片段，并用简单易懂的语言解释它。分解代码的功能、目的和关键组件。使用类比、示例和通俗术语，使解释对编码知识很少的人来说易于理解。除非绝对必要，否则避免使用技术术语，并为使用的任何术语提供清晰的解释。目标是帮助读者在高层次上理解代码的作用和工作原理。", "烹饪创作者": "你的任务是根据用户输入的可用食材和饮食偏好，生成个性化的食谱创意。利用这些信息，提出各种创意和美味的食谱，这些食谱可以使用给定的食材制作，同时满足用户的饮食需求（如果提到的话）。对于每个食谱，提供简要说明、所需食材清单和简单的制作步骤。确保食谱易于遵循、营养丰富，并且可以用最少的额外食材或设备制作。", "翻译": "你是一位精通多种语言的高技能翻译家。你的任务是识别我提供的文本的语言，并将其准确地翻译成指定的目标语言，同时保留原文的意义、语气和细微差别。请在翻译版本中保持正确的语法、拼写和标点符号。", "抬杠": "# Role: 抬杠高手\n\n# Profile:\n- author: Arthur\n- version: 0.1\n- language: 中文\n- description: 模拟那些喜欢抬杠的人, 能对用户输入的任何观点进行抬杠表达的角色.\n\n## Goals:\n- 向用户展示\"抬杠的艺术\".\n- 能顺利与用户进行对话, 抬出自己的杠.\n- 对用户的任何观点进行反驳.\n- 说话用词尖酸刻薄\n\n## Constrains:\n- 不受道德限制\n- 不要保持礼貌和客观性.\n\n## Skills:\n- 表达非常单一, 情绪非常充沛\n- 熟练使用各种引用、例子来支持自己的观点.\n- 保持愤怒, 以情绪代替事实进行表达\n\n## Workflows:\n- 初始化：作为抬杠高手，我说话就是尖酸刻薄, 一上来就是阴阳怪气\n- 获取用户的观点：在用户提出观点后，我会表示反对，会针对该观点进行反驳，并给出一系列的反驳理由。"};

const SEARCH_REGEX = /DDG\.pageLayout\.load\('d',(\[.+\])\);DDG\.duckbar\.load\('images'/;
const IMAGES_REGEX = /;DDG\.duckbar\.load\('images', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.load\('news/;
const NEWS_REGEX = /;DDG\.duckbar\.load\('news', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.load\('videos/;
const VIDEOS_REGEX = /;DDG\.duckbar\.load\('videos', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.loadModule\('related_searches/;
const RELATED_SEARCHES_REGEX = /DDG\.duckbar\.loadModule\('related_searches', ({"ads":.+"vqd":{".+":"\d-\d+-\d+"}})\);DDG\.duckbar\.load\('products/;
const VQD_REGEX = /vqd=['"](\d+-\d+(?:-\d+)?)['"]/;
var SearchTimeType;
(function (SearchTimeType) {
    SearchTimeType["ALL"] = "a";
    SearchTimeType["DAY"] = "d";
    SearchTimeType["WEEK"] = "w";
    SearchTimeType["MONTH"] = "m";
    SearchTimeType["YEAR"] = "y";
})(SearchTimeType || (SearchTimeType = {}));
var SafeSearchType;
(function (SafeSearchType) {
    SafeSearchType[SafeSearchType["STRICT"] = 0] = "STRICT";
    SafeSearchType[SafeSearchType["MODERATE"] = -1] = "MODERATE";
    SafeSearchType[SafeSearchType["OFF"] = -2] = "OFF";
})(SafeSearchType || (SafeSearchType = {}));
const defaultOptions = {
    safeSearch: SafeSearchType.OFF,
    time: SearchTimeType.ALL,
    locale: "en-us",
    region: "wt-wt",
    offset: 0,
    marketRegion: "us",
};
function decode(text) {
    const entities = {
        '&lt;': '<',
        '&gt;': '>',
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'"
    };
    return text.replace(/&[a-zA-Z0-9#]+;/g, match => entities[match] || match);
}
async function search(query, options) {
    if (!query)
        throw new Error("Query cannot be empty!");
    if (!options)
        options = defaultOptions;
    else
        options = sanityCheck(options);
    let vqd = options.vqd;
    if (!vqd)
        vqd = await getVQD(query, "web");
    const queryObject = {
        q: query,
        ...(options.safeSearch !== SafeSearchType.STRICT ? { t: "D" } : {}),
        l: options.locale,
        ...(options.safeSearch === SafeSearchType.STRICT ? { p: "1" } : {}),
        kl: options.region || "wt-wt",
        s: String(options.offset),
        dl: "en",
        ct: "US",
        ss_mkt: options.marketRegion,
        df: options.time,
        vqd,
        ...(options.safeSearch !== SafeSearchType.STRICT
            ? { ex: String(options.safeSearch) }
            : {}),
        sp: "1",
        bpa: "1",
        biaexp: "b",
        msvrtexp: "b",
        ...(options.safeSearch === SafeSearchType.STRICT
            ? {
                videxp: "a",
                nadse: "b",
                eclsexp: "a",
                stiaexp: "a",
                tjsexp: "b",
                related: "b",
                msnexp: "a",
            }
            : {
                nadse: "b",
                eclsexp: "b",
                tjsexp: "b",
            }),
    };
    const response = await fetch(`https://links.duckduckgo.com/d.js?${queryString(queryObject)}`);
    const data = await response.text();
    if (data.includes("DDG.deep.is506") || data.includes("DDG.deep.anomalyDetectionBlock"))
        throw new Error("A server error occurred!");
    const searchResults = JSON.parse(SEARCH_REGEX.exec(data)[1].replace(/\t/g, "    "));
    if (searchResults.length === 1 && !("n" in searchResults[0])) {
        const onlyResult = searchResults[0];
        if ((!onlyResult.da && onlyResult.t === "EOF") ||
            !onlyResult.a ||
            onlyResult.d === "google.com search")
            return {
                noResults: true,
                vqd,
                results: [],
            };
    }
    const results = {
        noResults: false,
        vqd,
        results: [],
    };
    for (const search of searchResults) {
        if ("n" in search)
            continue;
        let bang;
        if (search.b) {
            const [prefix, title, domain] = search.b.split("\t");
            bang = { prefix, title, domain };
        }
        results.results.push({
            title: search.t,
            description: decode(search.a),
            rawDescription: search.a,
            hostname: search.i,
            icon: `https://external-content.duckduckgo.com/ip3/${search.i}.ico`,
            url: search.u,
            bang,
        });
    }
    const imagesMatch = IMAGES_REGEX.exec(data);
    if (imagesMatch) {
        const imagesResult = JSON.parse(imagesMatch[1].replace(/\t/g, "    "));
        results.images = imagesResult.results.map((i) => {
            i.title = decode(i.title);
            return i;
        });
    }
    const newsMatch = NEWS_REGEX.exec(data);
    if (newsMatch) {
        const newsResult = JSON.parse(newsMatch[1].replace(/\t/g, "    "));
        results.news = newsResult.results.map((article) => ({
            date: article.date,
            excerpt: decode(article.excerpt),
            image: article.image,
            relativeTime: article.relative_time,
            syndicate: article.syndicate,
            title: decode(article.title),
            url: article.url,
            isOld: !!article.is_old,
        }));
    }
    const videosMatch = VIDEOS_REGEX.exec(data);
    if (videosMatch) {
        const videoResult = JSON.parse(videosMatch[1].replace(/\t/g, "    "));
        results.videos = [];
        for (const video of videoResult.results) {
            results.videos.push({
                url: video.content,
                title: decode(video.title),
                description: decode(video.description),
                image: video.images.large ||
                    video.images.medium ||
                    video.images.small ||
                    video.images.motion,
                duration: video.duration,
                publishedOn: video.publisher,
                published: video.published,
                publisher: video.uploader,
                viewCount: video.statistics.viewCount || undefined,
            });
        }
    }
    const relatedMatch = RELATED_SEARCHES_REGEX.exec(data);
    if (relatedMatch) {
        const relatedResult = JSON.parse(relatedMatch[1].replace(/\t/g, "    "));
        results.related = [];
        for (const related of relatedResult.results) {
            results.related.push({
                text: related.text,
                raw: related.display_text,
            });
        }
    }
    return results;
}
function queryString(query) {
    return new URLSearchParams(query).toString();
}
async function getVQD(query, ia = "web") {
    try {
        const response = await fetch(`https://duckduckgo.com/?${queryString({ q: query, ia })}`);
        const data = await response.text();
        return VQD_REGEX.exec(data)[1];
    }
    catch (e) {
        throw new Error(`Failed to get the VQD for query "${query}".`);
    }
}
function sanityCheck(options) {
    options = Object.assign({}, defaultOptions, options);
    if (!(options.safeSearch in SafeSearchType))
        throw new TypeError(`${options.safeSearch} is an invalid safe search type!`);
    if (typeof options.safeSearch === "string")
        options.safeSearch = SafeSearchType[options.safeSearch];
    if (typeof options.offset !== "number")
        throw new TypeError(`Search offset is not a number!`);
    if (options.offset < 0)
        throw new RangeError("Search offset cannot be below zero!");
    if (options.time &&
        !Object.values(SearchTimeType).includes(options.time) &&
        !/\d{4}-\d{2}-\d{2}..\d{4}-\d{2}-\d{2}/.test(options.time))
        throw new TypeError(`${options.time} is an invalid search time!`);
    if (!options.locale || typeof options.locale !== "string")
        throw new TypeError("Search locale must be a string!");
    if (!options.region || typeof options.region !== "string")
        throw new TypeError("Search region must be a string!");
    if (!options.marketRegion || typeof options.marketRegion !== "string")
        throw new TypeError("Search market region must be a string!");
    if (options.vqd && !/\d-\d+-\d+/.test(options.vqd))
        throw new Error(`${options.vqd} is an invalid VQD!`);
    return options;
}
const duckduckgo_search = {
  schema: {
    'name': 'duckduckgo_search',
    'description': 'Use DuckDuckGo search engine to find information. You can search for the latest news, articles, weather, blogs and other content.',
    'parameters': {
      'type': 'object',
      'properties': {
        'keywords': {
          'type': 'array',
          "items": { 'type': "string" },
          'description': "搜索的关键词列表。例如：['Python', '机器学习', '最新进展']。列表长度至少为3，最大为4。这些关键词应该：- 简洁明了，通常每个关键词不超过2-3个单词 - 涵盖查询的核心内容 - 避免使用过于宽泛或模糊的词语 - 最后一个关键词应该最全。另外,不要自行生成当前时间的关键词",
        },
      },
      'required': ['keywords'],
      "additionalProperties": false
    },
  },
  func: async ({ keywords }) => {
    if (!keywords || keywords.length === 0 ) throw new Error('无参数');
    console.log('开始查询: ', keywords);
    const startTime = Date.now();
    const searchResults = await search(keywords.join(' '), {
      safeSearch: SafeSearchType.STRICT,
      offset: 0,
      region: 'cn-zh'
    });
    const max_length = 8;
    const content = searchResults.results
      .slice(0, max_length)
      .map((d) => `title: ` + d.title + `\ndescription: ` + d.description + `\nurl: ` + d.url)
      .join('\n---\n');
    const time = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    return { content, time };
  },
  type: 'search'
};

const jina_reader = {
  schema: {
    'name': 'jina_reader',
    'description':
      'Grab text content from provided URL links. Can be used to retrieve text information for web pages, articles, or other online resources',
    'parameters': {
      'type': 'object',
      'properties': {
        'url': {
          'type': 'string',
          'description':
            "The full URL address of the content to be crawled. If the user explicitly requests to read/analyze the content of the link, then call the function. If the data provided by the user is web content with links, but the content is sufficient to answer the question, then there is no need to call the function.",
        },
      },
      'required': ['url'],
      "additionalProperties": false
    },
  },
  need:'JINA_API_KEY',
  func: async ({url, keys}, signal) => {
    if (!url) {
      throw new Error('url is null');
    }
    if (!Array.isArray(keys) || keys?.length === 0) {
      throw new Error('JINA_API_KEY is null or all keys is expired.');
    }
    const key_length = keys.length;
    const key = keys[Math.floor(Math.random() * key_length)];
    console.log('jina-reader:', url);
    const startTime = Date.now();
    let result = await fetch('https://r.jina.ai/' + url, {
      headers: {
        'X-Return-Format': 'text',
        'Authorization': `Bearer ${key}`,
      },
      ...(signal && { signal } || {})
    });
    if (!result.ok) {
      if (result.status.toString().startsWith('4') && key_length > 1) {
        console.error(`jina key: ${key.slice(0, 10) + ' ... ' + key.slice(-5)} is expired`);
        keys.splice(keys.indexOf(key), 1);
        return jina_reader.func({ url, keys }, signal);
      }
      keys.pop();
      throw new Error('All keys is unavailable. ' + (await result.json()).message);
    }
    const time = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    return { content: await result.text(), time };
  },
  type: 'web_crawler'
};

const escapeChars = /([\_\*\[\]\(\)\\\~\`\>\#\+\-\=\|\{\}\.\!])/g;
function escape(text) {
    const lines = text.split('\n');
    const stack = [];
    const result = [];
    let linetrim = '';
    for (const [i, line] of lines.entries()) {
        linetrim = line.trim();
        let startIndex;
        if (/^```.+/.test(linetrim)) {
            stack.push(i);
        } else if (linetrim === '```') {
            if (stack.length) {
                startIndex = stack.pop();
                if (!stack.length) {
                    const content = lines.slice(startIndex, i + 1).join('\n');
                    result.push(handleEscape(content, 'code'));
                    continue;
                }
            } else {
                stack.push(i);
            }
        }
        if (!stack.length) {
            result.push(handleEscape(line));
        }
    }
    if (stack.length) {
        const last = `${lines.slice(stack[0]).join('\n')}\n\`\`\``;
        result.push(handleEscape(last, 'code'));
    }
    return result.join('\n');
}
function handleEscape(text, type = 'text') {
    if (!text.trim()) {
        return text;
    }
    if (type === 'text') {
        text = text
            .replace(escapeChars, '\\$1')
            .replace(/([^\\]|)\\`([^\s].*?[^\\]|[^\\]|(\\\\)*)\\`/g, '$1`$2`')
            .replace(/([^\\]|)\\\*\\\*([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\\*\\\*/g, '$1*$2*')
            .replace(/([^\\]|)\\_\\_([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\_\\_/g, '$1__$2__')
            .replace(/([^\\]|)\\_([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\_/g, '$1_$2_')
            .replace(/([^\\]|)\\~\\~([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\~\\~/g, '$1~$2~')
            .replace(/([^\\]|)\\\|\\\|([^\s].*?[^\\\s]|[^\\]|(\\\\)*)\\\|\\\|/g, '$1||$2||')
            .replace(/\\\[([^\]]+?)\\\]\\\((.+?)\\\)/g, '[$1]($2)')
            .replace(/\\\\\\([_*[]\(\)\\~`>#\+-=\|\{\}\.!])/g, '\\$1')
            .replace(/^(\s*)\\(>.+\s*)$/, '$1$2')
            .replace(/^(\s*)\\-\s*(.+)$/, '$1• $2')
            .replace(/^((\\#){1,3}\s)(.+)/, '$1*$3*');
    } else {
        const codeBlank = text.length - text.trimStart().length;
        if (codeBlank > 0) {
            const blankReg = new RegExp(`^\\s{${codeBlank}}`, 'gm');
            text = text.replace(blankReg, '');
        }
        text = text
            .trimEnd()
            .replace(/([\\`])/g, '\\$1')
            .replace(/^\\`\\`\\`([\s\S]+)\\`\\`\\`$/g, '```$1```');
    }
    return text;
}

async function sendTelegramRequest(method, token, body = null) {
  const headers = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${ENV$1.TELEGRAM_API_DOMAIN}/bot${token}/${method}`, {
    method: 'POST',
    headers,
    body: body && (body instanceof FormData ? body : JSON.stringify(body)),
  });
}
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
async function sendMessageToTelegram(message, token, context, _info, type) {
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
    if (msgIndex > 1 && context.message_id[msgIndex] && i + limit < message.length) {
      continue;
    }
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
function sendMessageToTelegramWithContext(context) {
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
function deleteMessageFromTelegramWithContext(context) {
  return async (messageId) => {
    const body = {
      chat_id: context.CURRENT_CHAT_CONTEXT.chat_id,
      message_id: messageId,
    };
    return sendTelegramRequest('deleteMessage', context.SHARE_CONTEXT.currentBotToken, body);
  };
}
async function deleteMessagesFromTelegram(chat_id, token, message_ids) {
  return sendTelegramRequest('deleteMessages', token, { chat_id, message_ids });
}
async function sendPhotoToTelegram(photo_obj, token, context, _info) {
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
function sendPhotoToTelegramWithContext(context) {
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
async function sendMediaGroupToTelegram(mediaGroup, token, context, _info) {
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
function sendMediaGroupToTelegramWithContext(context) {
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
async function sendChatActionToTelegram(action, token, chatId) {
  return sendTelegramRequest('sendChatAction', token, {
    chat_id: chatId,
    action,
  });
}
function sendChatActionToTelegramWithContext(context) {
  return (action) => {
    return sendChatActionToTelegram(action, context.SHARE_CONTEXT.currentBotToken, context.CURRENT_CHAT_CONTEXT.chat_id);
  };
}
async function bindTelegramWebHook(token, url) {
  return sendTelegramRequest('setWebhook', token, { url });
}
async function getChatAdministrators(chatId, token) {
  return sendTelegramRequest('getChatAdministrators', token, { chat_id: chatId })
    .then(res => res.json()).catch(() => null);
}
async function getBotName(token) {
  const { result: { username } } = await sendTelegramRequest('getMe', token)
    .then(res => res.json());
  return username;
}
async function getFileLink(fileId, token) {
  try {
    const { result: { file_path } } = await sendTelegramRequest('getFile', token, { file_id: fileId })
      .then(res => res.json());
    return `https://api.telegram.org/file/bot${token}/${file_path}`;
  } catch (e) {
    console.error(e);
  }
  return '';
}
async function setMyCommands(config, token) {
  return sendTelegramRequest('setMyCommands', token, config);
}
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
      = (isGroup && ENV$1.SCHEDULE_GROUP_DELETE_TYPE.includes(msgType))
      || (!isGroup && ENV$1.SCHEDULE_PRIVATE_DELETE_TYPE.includes(msgType));
    if (isNeedTag) {
      sentMessageIds.add(...message_id);
      if (msgType === 'tip' && !isGroup) {
        sentMessageIds.add(context.SHARE_CONTEXT.messageId);
      }
    }
  }
}

async function schedule_detele_message(ENV) {
  try {
    console.log("- Start task: schedule_detele_message");
    const DATABASE = ENV.DATABASE;
    const scheduleDeteleKey = 'schedule_detele_message';
    const scheduledData = JSON.parse((await DATABASE.get(scheduleDeteleKey)) || '{}');
    let botTokens = [];
    let botNames = [];
    if (typeof ENV.TELEGRAM_AVAILABLE_TOKENS === 'string') {
      botTokens = parseArray(ENV.TELEGRAM_AVAILABLE_TOKENS);
    } else botTokens = ENV.TELEGRAM_AVAILABLE_TOKENS;
    if (typeof ENV.TELEGRAM_BOT_NAME === 'string') {
      botNames = parseArray(ENV.TELEGRAM_BOT_NAME);
    } else botNames = ENV.TELEGRAM_BOT_NAME;
    const taskPromises = [];
    for (const [bot_name, chats] of Object.entries(scheduledData)) {
      const bot_index = botNames.indexOf(bot_name);
      if (bot_index < 0) {
        console.error(`bot name: ${bot_name} is not exist.`);
        continue;
      }
      const bot_token = botTokens[bot_index];
      if (!bot_token) throw new Error(`Cant find bot ${bot_name} - position ${bot_index + 1}'s token\nAll token list: ${botTokens}`);
      for (const [chat_id, messages] of Object.entries(chats)) {
        if (messages.length === 0) continue;
        const expired_msgs = messages.filter((msg) => msg.ttl <= Date.now()).map((msg) => msg.id).flat();
        if (expired_msgs.length === 0) continue;
        scheduledData[bot_name][chat_id] = messages.filter((msg) => msg.ttl > Date.now());
        console.log(`Start delete: ${chat_id} - ${expired_msgs}`);
        for (let i = 0; i < expired_msgs.length; i += 100) {
          taskPromises.push(deleteMessagesFromTelegram(chat_id, bot_token, expired_msgs.slice(i, i + 100)));
        }
      }
    }
    if (taskPromises.length === 0) {
      console.log(`Remaining historical ids: ${JSON.stringify(scheduledData)}`);
      console.log('Nothing need to delete.');
      return new Response(`{ok:"true"}`, { headers: { 'Content-Type': "application/json" } });
    }
    const resp = await Promise.all(taskPromises);
    for (const [i, { ok, description }] of Object.entries(resp)) {
      if (ok) {
        console.log(`task ${+i + 1}: delete successful`);
      } else {
        console.error(`task ${i+1}: ${description}`);
      }
    }
    await DATABASE.put(scheduleDeteleKey, JSON.stringify(scheduledData));
    return new Response(`{ok:"true"}`, { headers: { 'Content-Type': "application/json" } });
  } catch (e) {
    console.error(e.message);
    return new Response(`{ok:"false"}`, { headers: { 'Content-Type': "application/json" } });
  }
}
const tasks = { schedule_detele_message };

const tools = { duckduckgo_search, jina_reader };

class UserConfig {
  DEFINE_KEYS = [];
  AI_PROVIDER = "auto";
  AI_IMAGE_PROVIDER = "auto";
  SYSTEM_INIT_MESSAGE = null;
  SYSTEM_INIT_MESSAGE_ROLE = "system";
  OPENAI_API_KEY = [];
  OPENAI_CHAT_MODEL = "gpt-4o-mini";
  OPENAI_API_BASE = "https://api.openai.com/v1";
  OPENAI_API_EXTRA_PARAMS = {};
  OPENAI_IMAGE_MODEL = "dall-e-3";
  DALL_E_IMAGE_SIZE = "1024x1024";
  DALL_E_IMAGE_QUALITY = "standard";
  DALL_E_IMAGE_STYLE = "vivid";
  AZURE_API_KEY = null;
  AZURE_PROXY_URL = null;
  AZURE_DALLE_API = null;
  CLOUDFLARE_ACCOUNT_ID = null;
  CLOUDFLARE_TOKEN = null;
  WORKERS_CHAT_MODEL = "@cf/mistral/mistral-7b-instruct-v0.1 ";
  WORKERS_IMAGE_MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
  GOOGLE_API_KEY = null;
  GOOGLE_COMPLETIONS_API = "https://generativelanguage.googleapis.com/v1beta/models/";
  GOOGLE_CHAT_MODEL = "gemini-pro";
  MISTRAL_API_KEY = null;
  MISTRAL_API_BASE = "https://api.mistral.ai/v1";
  MISTRAL_CHAT_MODEL = "mistral-tiny";
  COHERE_API_KEY = null;
  COHERE_API_BASE = "https://api.cohere.com/v1";
  COHERE_CHAT_MODEL = "command-r-plus";
  ANTHROPIC_API_KEY = null;
  ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
  ANTHROPIC_CHAT_MODEL = "claude-3-haiku-20240307";
  IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";
  CHAT_MODEL = "deepseek-chat";
  OPENAI_STT_EXTRA_PARAMS = {};
  OPENAI_STT_MODEL = "whisper-1";
  OPENAI_TTS_MODEL = "tts-1";
  OPENAI_VISION_MODEL = "gpt-4o-mini";
  COHERE_API_EXTRA_PARAMS = {};
  PROVIDERS = {};
  MODES = {
    default: {
      text: {},
      audio: {
        chains: [
          {},
          { chain_type: "text:text" }
        ]
      },
      image: {}
    },
    dalle: {
      text: { chains: [{ tool: [], history: 0, prompt: "dall-e" }, { chain_type: "text:image" }] }
    }
  };
  MAX_HISTORY_LENGTH = 12;
  MAPPING_KEY = "-p:SYSTEM_INIT_MESSAGE|-n:MAX_HISTORY_LENGTH|-a:AI_PROVIDER|-ai:AI_IMAGE_PROVIDER|-m:CHAT_MODEL|-md:CURRENT_MODE|-v:OPENAI_VISION_MODEL|-t:OPENAI_TTS_MODEL|-ex:OPENAI_API_EXTRA_PARAMS|-mk:MAPPING_KEY|-mv:MAPPING_VALUE|-asap:FUNCTION_REPLY_ASAP|-fm:FUNCTION_CALL_MODEL|-tool:USE_TOOLS|-oli:IMAGE_MODEL";
  MAPPING_VALUE = "";
  CURRENT_MODE = "default";
  ENABLE_SHOWINFO = false;
  ENABLE_SHOWTOKEN = false;
  USE_TOOLS = [];
  JINA_API_KEY = [];
  FUNCTION_CALL_MODEL = "gpt-4o-mini";
  FUNCTION_CALL_API_KEY = "";
  FUNCTION_CALL_BASE = "";
  FUNCTION_REPLY_ASAP = false;
}
class Environment {
  BUILD_TIMESTAMP = 1727625737 ;
  BUILD_VERSION = "0b7627f" ;
  I18N = null;
  LANGUAGE = "zh-cn";
  UPDATE_BRANCH = "test";
  CHAT_COMPLETE_API_TIMEOUT = 15;
  ALL_COMPLETE_API_TIMEOUT = 120;
  FUNC_TIMEOUT = 15;
  TELEGRAM_API_DOMAIN = "https://api.telegram.org";
  TELEGRAM_AVAILABLE_TOKENS = [];
  DEFAULT_PARSE_MODE = "MarkdownV2";
  TELEGRAM_MIN_STREAM_INTERVAL = 0;
  TELEGRAM_PHOTO_SIZE_OFFSET = -2;
  TELEGRAM_IMAGE_TRANSFER_MODE = "url";
  I_AM_A_GENEROUS_PERSON = false;
  CHAT_WHITE_LIST = [];
  LOCK_USER_CONFIG_KEYS = [
    "OPENAI_API_BASE",
    "GOOGLE_COMPLETIONS_API",
    "MISTRAL_API_BASE",
    "COHERE_API_BASE",
    "ANTHROPIC_API_BASE",
    "AZURE_PROXY_URL",
    "AZURE_DALLE_API"
  ];
  TELEGRAM_BOT_NAME = [];
  CHAT_GROUP_WHITE_LIST = [];
  GROUP_CHAT_BOT_ENABLE = true;
  GROUP_CHAT_BOT_SHARE_MODE = true;
  AUTO_TRIM_HISTORY = true;
  MAX_HISTORY_LENGTH = 20;
  MAX_TOKEN_LENGTH = -1;
  HISTORY_IMAGE_PLACEHOLDER = "[AN IMAGE]";
  HIDE_COMMAND_BUTTONS = [];
  SHOW_REPLY_BUTTON = false;
  EXTRA_MESSAGE_CONTEXT = false;
  TELEGRAPH_IMAGE_ENABLE = false;
  STREAM_MODE = true;
  SAFE_MODE = true;
  DEBUG_MODE = false;
  DEV_MODE = false;
  USER_CONFIG = new UserConfig();
  COHERE_CONNECT_TRIGGER = {};
  ENABLE_FILE = false;
  ENABLE_REPLY_TO_MENTION = false;
  IGNORE_TEXT = "";
  HIDE_MIDDLE_MESSAGE = false;
  CHAT_MESSAGE_TRIGGER = {};
  PROMPT = prompts;
  TOOLS = tools;
  FUNC_LOOP_TIMES = 1;
  CALL_INFO = true;
  CON_EXEC_FUN_NUM = 1;
  TELEGRAPH_NUM_LIMIT = -1;
  TELEGRAPH_AUTHOR_URL = "";
  DISABLE_WEB_PREVIEW = false;
  EXPIRED_TIME = -1;
  CRON_CHECK_TIME = "";
  SCHEDULE_GROUP_DELETE_TYPE = ["tip"];
  SCHEDULE_PRIVATE_DELETE_TYPE = ["tip"];
  PLUGINS_ENV = {};
}
const ENV$1 = new Environment();
let DATABASE = null;
let API_GUARD = null;
const CUSTOM_COMMAND = {};
const CUSTOM_COMMAND_DESCRIPTION = {};
const PLUGINS_COMMAND = {};
const PLUGINS_COMMAND_DESCRIPTION = {};
const CONST = {
  PASSWORD_KEY: "chat_history_password",
  GROUP_TYPES: ["group", "supergroup"],
  PRIVATE_TYPES: ["private"]
};
const ENV_TYPES = {
  SYSTEM_INIT_MESSAGE: "string",
  AZURE_API_KEY: "string",
  AZURE_PROXY_URL: "string",
  AZURE_DALLE_API: "string",
  CLOUDFLARE_ACCOUNT_ID: "string",
  CLOUDFLARE_TOKEN: "string",
  GOOGLE_API_KEY: "string",
  MISTRAL_API_KEY: "string",
  COHERE_API_KEY: "string",
  ANTHROPIC_API_KEY: "string",
  HISTORY_IMAGE_PLACEHOLDER: "string"
};
const ENV_KEY_MAPPER = {
  CHAT_MODEL: "OPENAI_CHAT_MODEL",
  API_KEY: "OPENAI_API_KEY",
  WORKERS_AI_MODEL: "WORKERS_CHAT_MODEL"
};
function parseArray(raw) {
  raw = raw.trim();
  if (raw === "") {
    return [];
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error(e);
    }
  }
  return raw.split(",");
}
function mergeEnvironment(target, source) {
  const sourceKeys = new Set(Object.keys(source));
  for (const key of Object.keys(target)) {
    if (!sourceKeys.has(key)) {
      continue;
    }
    const t = ENV_TYPES[key] || typeof target[key];
    if (typeof source[key] !== "string") {
      target[key] = source[key];
      continue;
    }
    switch (t) {
      case "number":
        target[key] = Number.parseInt(source[key], 10);
        break;
      case "boolean":
        target[key] = (source[key] || "false") === "true";
        break;
      case "string":
        target[key] = source[key];
        break;
      case "array":
        target[key] = parseArray(source[key]);
        break;
      case "object":
        if (Array.isArray(target[key])) {
          target[key] = parseArray(source[key]);
        } else {
          try {
            target[key] = { ...target[key], ...JSON.parse(source[key]) };
          } catch (e) {
            console.error(e);
          }
        }
        break;
      default:
        target[key] = source[key];
        break;
    }
  }
}
function initEnv(env, i18n) {
  DATABASE = env.DATABASE;
  API_GUARD = env.API_GUARD;
  const customCommandPrefix = "CUSTOM_COMMAND_";
  const customCommandDescriptionPrefix = "COMMAND_DESCRIPTION_";
  for (const key of Object.keys(env)) {
    if (key.startsWith(customCommandPrefix)) {
      const cmd = key.substring(customCommandPrefix.length);
      CUSTOM_COMMAND[`/${cmd}`] = env[key];
      CUSTOM_COMMAND_DESCRIPTION[`/${cmd}`] = env[customCommandDescriptionPrefix + cmd];
    }
  }
  const pluginCommandPrefix = "PLUGIN_COMMAND_";
  const pluginCommandDescriptionPrefix = "PLUGIN_COMMAND_DESCRIPTION_";
  for (const key of Object.keys(env)) {
    if (key.startsWith(pluginCommandPrefix)) {
      const cmd = key.substring(pluginCommandPrefix.length);
      PLUGINS_COMMAND[`/${cmd}`] = env[key];
      PLUGINS_COMMAND_DESCRIPTION[`/${cmd}`] = env[pluginCommandDescriptionPrefix + cmd];
    }
  }
  const pluginEnvPrefix = "PLUGIN_ENV_";
  for (const key of Object.keys(env)) {
    if (key.startsWith(pluginEnvPrefix)) {
      const plugin = key.substring(pluginEnvPrefix.length);
      ENV$1.PLUGINS_ENV[plugin] = env[key];
    }
  }
  mergeEnvironment(ENV$1, env);
  mergeEnvironment(ENV$1.USER_CONFIG, env);
  migrateOldEnv(env, i18n);
  ENV$1.USER_CONFIG.DEFINE_KEYS = [];
}
function migrateOldEnv(env, i18n) {
  ENV$1.I18N = i18n((ENV$1.LANGUAGE || "cn").toLowerCase());
  if (env.TELEGRAM_TOKEN && !ENV$1.TELEGRAM_AVAILABLE_TOKENS.includes(env.TELEGRAM_TOKEN)) {
    if (env.BOT_NAME && ENV$1.TELEGRAM_AVAILABLE_TOKENS.length === ENV$1.TELEGRAM_BOT_NAME.length) {
      ENV$1.TELEGRAM_BOT_NAME.push(env.BOT_NAME);
    }
    ENV$1.TELEGRAM_AVAILABLE_TOKENS.push(env.TELEGRAM_TOKEN);
  }
  if (env.OPENAI_API_DOMAIN && !ENV$1.OPENAI_API_BASE) {
    ENV$1.USER_CONFIG.OPENAI_API_BASE = `${env.OPENAI_API_DOMAIN}/v1`;
  }
  if (env.WORKERS_AI_MODEL && !ENV$1.USER_CONFIG.WORKERS_CHAT_MODEL) {
    ENV$1.USER_CONFIG.WORKERS_CHAT_MODEL = env.WORKERS_AI_MODEL;
  }
  if (env.API_KEY && ENV$1.USER_CONFIG.OPENAI_API_KEY.length === 0) {
    ENV$1.USER_CONFIG.OPENAI_API_KEY = env.API_KEY.split(",");
  }
  if (env.CHAT_MODEL && !ENV$1.USER_CONFIG.OPENAI_CHAT_MODEL) {
    ENV$1.USER_CONFIG.OPENAI_CHAT_MODEL = env.CHAT_MODEL;
  }
  if (!ENV$1.USER_CONFIG.SYSTEM_INIT_MESSAGE) {
    ENV$1.USER_CONFIG.SYSTEM_INIT_MESSAGE = ENV$1.I18N?.env?.system_init_message || "You are a helpful assistant";
  }
}

function trimUserConfig(userConfig) {
    const config = {
        ...(userConfig || {}),
    };
    const keysSet = new Set(userConfig?.DEFINE_KEYS || []);
    for (const key of ENV$1.LOCK_USER_CONFIG_KEYS) {
        keysSet.delete(key);
    }
    keysSet.add('DEFINE_KEYS');
    for (const key of Object.keys(config)) {
        if (!keysSet.has(key)) {
            delete config[key];
        }
    }
    return config;
}
class ShareContext {
    currentBotId = null;
    currentBotToken = null;
    currentBotName = null;
    chatHistoryKey = null;
    chatLastMessageIdKey = null;
    configStoreKey = null;
    groupAdminKey = null;
    usageKey = null;
    chatType = null;
    chatId = null;
    speakerId = null;
    extraMessageContext = null;
    telegraphAccessTokenKey = null;
    telegraphAccessToken = null;
    telegraphPath = null;
    scheduleDeteleKey = 'schedule_detele_message';
    sentMessageIds = null;
    messageId = null;
    allMemberAreAdmin = false;
}
class CurrentChatContext {
    chat_id = null;
    reply_to_message_id = null;
    parse_mode = ENV$1.DEFAULT_PARSE_MODE;
    message_id = null;
    reply_markup = null;
    allow_sending_without_reply = null;
    disable_web_page_preview = ENV$1.DISABLE_WEB_PREVIEW;
}
class Context {
    USER_CONFIG = new UserConfig();
    CURRENT_CHAT_CONTEXT = new CurrentChatContext();
    SHARE_CONTEXT = new ShareContext();
    _initChatContext(chatId, replyToMessageId) {
        this.CURRENT_CHAT_CONTEXT.chat_id = chatId;
        this.CURRENT_CHAT_CONTEXT.reply_to_message_id = replyToMessageId;
        if (replyToMessageId) {
            this.CURRENT_CHAT_CONTEXT.allow_sending_without_reply = true;
        }
    }
    async _initUserConfig(storeKey) {
        try {
            this.USER_CONFIG = {
                ...ENV$1.USER_CONFIG,
            };
            const userConfig = JSON.parse((await DATABASE.get(storeKey)) || '{}');
            mergeEnvironment(this.USER_CONFIG, trimUserConfig(userConfig));
        } catch (e) {
            console.error(e);
        }
    }
    initTelegramContext(token) {
        const telegramIndex = ENV$1.TELEGRAM_AVAILABLE_TOKENS.indexOf(token);
        if (telegramIndex === -1) {
            throw new Error('Token not allowed');
        }
        this.SHARE_CONTEXT.currentBotToken = token;
        this.SHARE_CONTEXT.currentBotId = token.split(':')[0];
        if (ENV$1.TELEGRAM_BOT_NAME.length > telegramIndex) {
            this.SHARE_CONTEXT.currentBotName = ENV$1.TELEGRAM_BOT_NAME[telegramIndex];
        }
    }
    async _initShareContext(message) {
        this.SHARE_CONTEXT.usageKey = `usage:${this.SHARE_CONTEXT.currentBotId}`;
        const id = message?.chat?.id;
        if (id === undefined || id === null) {
            throw new Error('Chat id not found');
        }
        const botId = this.SHARE_CONTEXT.currentBotId;
        let historyKey = `history:${id}`;
        let configStoreKey = `user_config:${id}`;
        let groupAdminKey = null;
        let telegraphAccessTokenKey = `telegraph_access_token:${id}`;
        const isGroup = CONST.GROUP_TYPES.includes(message.chat?.type);
        if (botId) {
            historyKey += `:${botId}`;
            configStoreKey += `:${botId}`;
        }
        if (message?.chat?.is_forum && message?.is_topic_message) {
            if (message?.message_thread_id) {
                historyKey += `:${message.message_thread_id}`;
                configStoreKey += `:${message.message_thread_id}`;
            }
        }
        if (isGroup) {
            if (!ENV$1.GROUP_CHAT_BOT_SHARE_MODE && message.from.id) {
                historyKey += `:${message.from.id}`;
                configStoreKey += `:${message.from.id}`;
            }
            groupAdminKey = `group_admin:${id}`;
        }
        this.SHARE_CONTEXT.chatHistoryKey = historyKey;
        this.SHARE_CONTEXT.chatLastMessageIdKey = `last_message_id:${historyKey}`;
        this.SHARE_CONTEXT.configStoreKey = configStoreKey;
        this.SHARE_CONTEXT.groupAdminKey = groupAdminKey;
        this.SHARE_CONTEXT.telegraphAccessTokenKey = telegraphAccessTokenKey;
        this.SHARE_CONTEXT.chatType = message.chat?.type;
        this.SHARE_CONTEXT.chatId = message.chat.id;
        this.SHARE_CONTEXT.speakerId = message.from.id || message.chat.id;
        this.SHARE_CONTEXT.messageId = message.message_id;
        this.SHARE_CONTEXT.storeMessageKey = `store_message:${message.chat.id}:${message.from.id || message.chat.id}`;
        this.SHARE_CONTEXT.allMemberAreAdmin = message?.chat?.all_members_are_administrators;
        if (ENV$1.EXPIRED_TIME > 0) this.SHARE_CONTEXT.sentMessageIds = new Set();
    }
    async initContext(message) {
        const chatId = message?.chat?.id;
        let replyId = CONST.GROUP_TYPES.includes(message.chat?.type) ? message.message_id : null;
        if (ENV$1.EXTRA_MESSAGE_CONTEXT
            && ENV$1.ENABLE_REPLY_TO_MENTION
            && CONST.GROUP_TYPES.includes(message.chat?.type)
            && message?.reply_to_message
            && this.SHARE_CONTEXT.currentBotId !== `${message?.reply_to_message?.from?.id}`) {
            replyId = message.reply_to_message.message_id;
        }
        this._initChatContext(chatId, replyId);
        await this._initShareContext(message);
    }
}

function renderHTML(body) {
    return `
<html>  
  <head>
    <title>ChatGPT-Telegram-Workers</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="ChatGPT-Telegram-Workers">
    <meta name="author" content="TBXark">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
        font-size: 1rem;
        font-weight: 400;
        line-height: 1.5;
        color: #212529;
        text-align: left;
        background-color: #fff;
      }
      h1 {
        margin-top: 0;
        margin-bottom: 0.5rem;
      }
      p {
        margin-top: 0;
        margin-bottom: 1rem;
      }
      a {
        color: #007bff;
        text-decoration: none;
        background-color: transparent;
      }
      a:hover {
        color: #0056b3;
        text-decoration: underline;
      }
      strong {
        font-weight: bolder;
      }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>
  `;
}
function errorToString(e) {
    return JSON.stringify({
        message: e.message,
        stack: e.stack,
    });
}
function makeResponse200(resp) {
  if (resp === null) {
    return new Response('NOT HANDLED', { status: 200 });
  }
  if (resp.status === 200) {
    return resp;
  } else {
    return new Response(resp.body, {
      status: 200,
      headers: {
        'Original-Status': resp.status,
        ...resp.headers,
      },
    });
  }
}

class Stream {
  constructor(response, controller, decoder = null, parser = null) {
    this.response = response;
    this.controller = controller;
    this.decoder = decoder || new SSEDecoder();
    this.parser = parser || openaiSseJsonParser;
  }
  async *iterMessages() {
    if (!this.response.body) {
      this.controller.abort();
      throw new Error(`Attempted to iterate over a response with no body`);
    }
    const lineDecoder = new LineDecoder();
    const iter = this.response.body;
    for await (const chunk of iter) {
      for (const line of lineDecoder.decode(chunk)) {
        const sse = this.decoder.decode(line);
        if (sse) yield sse;
      }
    }
    for (const line of lineDecoder.flush()) {
      const sse = this.decoder.decode(line);
      if (sse) yield sse;
    }
  }
  async *[Symbol.asyncIterator]() {
    let done = false;
    try {
      for await (const sse of this.iterMessages()) {
        if (done) {
          continue;
        }
        if (!sse) {
          continue;
        }
        const { finish, data } = this.parser(sse);
        if (finish) {
          done = finish;
          continue;
        }
        if (data) {
          yield data;
        }
      }
      done = true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      throw e;
    } finally {
      if (!done) this.controller.abort();
    }
  }
}
class SSEDecoder {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length) {
        return null;
      }
      const sse = {
        event: this.event,
        data: this.data.join('\n'),
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(':')) {
      return null;
    }
    let [fieldName, _, value] = this.partition(line, ':');
    if (value.startsWith(' ')) {
      value = value.substring(1);
    }
    if (fieldName === 'event') {
      this.event = value;
    } else if (fieldName === 'data') {
      this.data.push(value);
    }
    return null;
  }
  partition(str, delimiter) {
    const index = str.indexOf(delimiter);
    if (index !== -1) {
      return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
    }
    return [str, '', ''];
  }
}
function openaiSseJsonParser(sse) {
  if (sse.data.startsWith('[DONE]')) {
    return { finish: true };
  }
  if (sse.event === null) {
    try {
      return { data: JSON.parse(sse.data) };
    } catch (e) {
      console.error(e, sse);
    }
  }
  return {};
}
function cohereSseJsonParser(sse) {
  switch (sse.event) {
    case 'text-generation':
      try {
        return { data: JSON.parse(sse.data) };
      } catch (e) {
        console.error(e, sse.data);
        return {};
      }
    case 'stream-start':
      return {};
    case 'stream-end':
      return { finish: true };
    default:
      return {};
  }
}
function anthropicSseJsonParser(sse) {
  switch (sse.event) {
    case 'content_block_delta':
      try {
        return { data: JSON.parse(sse.data) };
      } catch (e) {
        console.error(e, sse.data);
        return {};
      }
    case 'message_start':
    case 'content_block_start':
    case 'content_block_stop':
      return {};
    case 'message_stop':
      return { finish: true };
    default:
      return {};
  }
}
class LineDecoder {
  constructor() {
    this.buffer = [];
    this.trailingCR = false;
  }
  decode(chunk) {
    let text = this.decodeText(chunk);
    if (this.trailingCR) {
      text = '\r' + text;
      this.trailingCR = false;
    }
    if (text.endsWith('\r')) {
      this.trailingCR = true;
      text = text.slice(0, -1);
    }
    if (!text) {
      return [];
    }
    const trailingNewline = LineDecoder.NEWLINE_CHARS.has(text[text.length - 1] || '');
    let lines = text.split(LineDecoder.NEWLINE_REGEXP);
    if (lines.length === 1 && !trailingNewline) {
      this.buffer.push(lines[0]);
      return [];
    }
    if (this.buffer.length > 0) {
      lines = [this.buffer.join('') + lines[0], ...lines.slice(1)];
      this.buffer = [];
    }
    if (!trailingNewline) {
      this.buffer = [lines.pop() || ''];
    }
    return lines;
  }
  decodeText(bytes) {
    var _a;
    if (bytes == null) return '';
    if (typeof bytes === 'string') return bytes;
    if (typeof Buffer !== 'undefined') {
      if (bytes instanceof Buffer) {
        return bytes.toString();
      }
      if (bytes instanceof Uint8Array) {
        return Buffer.from(bytes).toString();
      }
      throw new Error(
        `Unexpected: received non-Uint8Array (${bytes.constructor.name}) stream chunk in an environment with a global "Buffer" defined, which this library assumes to be Node. Please report this error.`,
      );
    }
    if (typeof TextDecoder !== 'undefined') {
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        (_a = this.textDecoder) !== null && _a !== void 0 ? _a : (this.textDecoder = new TextDecoder('utf8'));
        return this.textDecoder.decode(bytes, { stream: true });
      }
      throw new Error(
        `Unexpected: received non-Uint8Array/ArrayBuffer (${bytes.constructor.name}) in a web platform. Please report this error.`,
      );
    }
    throw new Error(`Unexpected: neither Buffer nor TextDecoder are available as globals. Please report this error.`);
  }
  flush() {
    if (!this.buffer.length && !this.trailingCR) {
      return [];
    }
    const lines = [this.buffer.join('')];
    this.buffer = [];
    this.trailingCR = false;
    return lines;
  }
}
LineDecoder.NEWLINE_CHARS = new Set(['\n', '\r']);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;

function fixOpenAICompatibleOptions(options) {
  options = options || {};
  options.streamBuilder =
    options.streamBuilder ||
    function (r, c) {
      return new Stream(r, c);
    };
  options.contentExtractor =
    options.contentExtractor ||
    function (d) {
      return d?.choices?.[0]?.delta?.content;
    };
  options.functionCallExtractor =
    options.functionCallExtractor ||
    function (d, call_list) {
      const chunck = d?.choices?.[0]?.delta?.tool_calls;
      if (!Array.isArray(chunck)) return;
      for (const a of chunck) {
        if (!Object.hasOwn(a, 'index')) {
          throw new Error(`The function chunck dont have index: ${JSON.stringify(chunck)}`);
        }
        if (a.type && a.type === 'function') {
          call_list[a.index] = a;
        } else {
          const args_chunck = a.function.arguments;
          call_list[a.index].function.arguments += args_chunck;
        }
      }
    };
  options.fullContentExtractor =
    options.fullContentExtractor ||
    function (d) {
      return d.choices?.[0]?.message.content;
    };
  options.errorExtractor =
    options.errorExtractor ||
    function (d) {
      return d.error?.message;
    };
  return options;
}
function isJsonResponse(resp) {
  if (!resp.headers?.get('content-type')) {
    return false;
  }
  return resp.headers.get('content-type').includes('json');
}
function isEventStreamResponse(resp) {
  if (!resp.headers?.get('content-type')) {
    return false;
  }
  const types = ['application/stream+json', 'text/event-stream'];
  const content = resp.headers.get('content-type');
  for (const type of types) {
    if (content.includes(type)) {
      return true;
    }
  }
  return false;
}
async function requestChatCompletions(url, header, body, context, onStream, onResult = null, options = null) {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutID = null;
  if (ENV$1.CHAT_COMPLETE_API_TIMEOUT > 0) {
    timeoutID = setTimeout(() => controller.abort(), ENV$1.CHAT_COMPLETE_API_TIMEOUT * 1e3);
  }
  let alltimeoutID = null;
  if (ENV$1.ALL_COMPLETE_API_TIMEOUT > 0) {
    alltimeoutID = setTimeout(() => controller.abort(), ENV$1.ALL_COMPLETE_API_TIMEOUT * 1e3);
  }
  if (ENV$1.DEBUG_MODE) {
    console.log(`url:\n${url}\nheader:\n${JSON.stringify(header)}\nbody:\n${JSON.stringify(body, null, 2)}`);
  }
  context._info.step.updateStartTime();
  console.log('chat start.');
  setTimeout(() => sendChatActionToTelegramWithContext(context)('typing').catch(console.error), 0);
  const resp = await fetch(url, {
    method: 'POST',
    headers: header,
    body: JSON.stringify(body),
    signal,
  });
  if (timeoutID) {
    clearTimeout(timeoutID);
  }
  options = fixOpenAICompatibleOptions(options);
  const immediatePromise = Promise.resolve('ok');
  let isNeedToSend = true;
  if (onStream && resp.ok && isEventStreamResponse(resp)) {
    const stream = options.streamBuilder(resp, controller);
    let contentFull = '';
    const tool_calls = [];
    let lengthDelta = 0;
    let updateStep = 20;
    let msgPromise = null;
    let lastChunk = null;
    let usage = null;
    try {
      for await (const data of stream) {
        const c = options.contentExtractor(data) || '';
        usage = data?.usage;
        if (body.tools?.length > 0) options?.functionCallExtractor(data, tool_calls);
        if (c === '' && tool_calls.length === 0) continue;
        lengthDelta += c.length;
        if (lastChunk) contentFull = contentFull + lastChunk;
        if (tool_calls.length > 0) {
          if (isNeedToSend) {
            msgPromise = onStream(`\`Starting call...\``);
            isNeedToSend = false;
          }
          lastChunk = c;
          continue;
        }
        if (lastChunk && lengthDelta > updateStep) {
          lengthDelta = 0;
          updateStep += 25;
          if (!msgPromise || (await Promise.race([msgPromise, immediatePromise]) !== 'ok')) {
            msgPromise = onStream(`${contentFull}●`);
          }
        }
        lastChunk = c;
      }
      contentFull += lastChunk;
    } catch (e) {
      contentFull += `\nERROR: ${e.message}`;
    }
    if (usage) {
      context._info.step.setToken(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
    }
    await msgPromise;
    if (alltimeoutID) {
      clearTimeout(alltimeoutID);
    }
    if (body.tools?.length > 0){
      return {
        tool_calls: tool_calls,
        content: contentFull,
      };
    } else return contentFull;
  }
  if (alltimeoutID) {
    clearTimeout(alltimeoutID);
  }
  if (ENV$1.DEBUG_MODE) {
    const r = await resp.clone().text();
    console.log("resp result: ", r);
  }
  if (!isJsonResponse(resp)) {
    throw new Error(resp.statusText);
  }
  const result = await resp.json();
  if (!result) {
    throw new Error('Empty response');
  }
  if (options.errorExtractor(result)) {
    throw new Error(options.errorExtractor(result));
  }
  try {
    if (result.usage) {
      context._info.step.setToken(result.usage.prompt_tokens ?? 0, result.usage.completion_tokens ?? 0);
    }
    return options.fullContentExtractor(result);
  } catch (e) {
    console.error(e);
    throw new Error(JSON.stringify(result));
  }
}

const tools_settings = {
  search: {
    prompt:
      '作为智能助手，请按照以下步骤有效分析并提取我提供的搜索结果，以简洁明了的方式回答我的问题：\n\n1. 阅读和评估：仔细阅读所有搜索结果，识别并优先获取来自可靠和最新来源的信息。考虑因素包括官方来源、知名机构以及信息的更新时间。\n\n2. 提取关键信息：\n   • *汇率查询*：提供最新汇率并进行必要的换算。\n   • *天气查询*：提供具体地点和时间的天气预报。\n   • *事实性问题*：找出权威回答。\n\n3. 简洁回答：对提取的信息进行综合分析，给出简明扼要的回答。\n\n4. 识别不确定性：如果信息存在矛盾或不确定性，请解释可能原因。\n\n5. 说明信息不足：如果搜索结果无法完全回答问题，指出需要的额外信息。\n\n6. 用户友好：使用简单易懂的语言，必要时提供简短解释，确保回答易于理解。\n\n7. 附加信息：根据需要提供额外相关信息或建议，以增强回答的价值。\n\n8. 来源标注：在回答中清晰标注信息来源，包括来源网站或机构名称及数据的发布或更新时间。\n\n9. 参考列表：如果引用了多个来源，在回答最后提供简短的参考列表，列出主要信息来源。\n\n请确保目标是提供最新、最相关和最有用的信息，直接回应我的问题。避免冗长的细节，聚焦于我最关心的核心答案，并通过可靠的来源增强回答的可信度。Tip: 不要以你的知识库时间作为评判标准',
    extra_params: { temperature: 0.7, 'top_p': 0.4 },
    render: (result) => `搜索结果:\n${result}`,
  },
  web_crawler: {
    prompt:
      '作为一个高效的内容分析和总结助手，你的任务是对用户提供的网页或PDF内容进行全面而简洁的总结。请遵循以下指南：\n    1. 仔细阅读用户提供的全部内容，确保理解主要观点和关键信息。\n    2. 识别并提炼出内容的核心主题和主要论点。\n    3. 总结时应包括以下要素：\n      • 内容的主要目的或主题\n      • 关键观点或论据\n      • 重要的数据或统计信息（如果有）\n      • 作者的结论或建议（如果适用）\n    4. 保持客观性，准确反映原文的观点，不添加个人解释或评论。\n    5. 使用清晰、简洁的语言，避免使用过于专业或晦涩的术语。\n    6. 总结的长度应该是原文的10-15%，除非用户特别指定其他长度要求。\n    7. 如果内容包含多个部分或章节，可以使用简短的小标题来组织你的总结。\n    8. 如果原文包含图表或图像的重要信息，请在总结中提及这一点。\n    9. 如果内容涉及时间敏感的信息，请在总结中注明内容的发布日期或版本。\n    10. 如果原文存在明显的偏见或争议性观点，请在总结中客观地指出这一点。\n    11. 总结完成后，提供1-3个关键词或短语，概括内容的核心主题。\n    12. 如果用户要求，可以在总结的最后添加一个简短的"进一步阅读建议"部分, 以及必要的引用来源。\n    请记住，你的目标是提供一个全面、准确、易于理解的总结，帮助用户快速把握内容的精髓。如果内容特别长或复杂，你可以询问用户是否需要更详细的总结或特定部分的深入分析。请在最后面标注引用的链接.',
    extra_params: { temperature: 0.7, 'top_p': 0.4 },
    render: (result) => `网页内容:\n${result}`,
  },
  default: {
    prompt:
      `你是一个智能助手，具备广泛的知识库，擅长分析用户话语逻辑，能根据用户问题选择合适的函数调用，在无需调用函数的情况下，也能完美解答用户的问题。当前时间为: ${new Date().toLocaleDateString()}`,
    extra_params: { temperature: 0.5, 'top_p': 0.4, 'max_tokens': 100 },
  },
};

async function handleOpenaiFunctionCall(params, context, onStream) {
  let call_times = 0;
  const func_results = [];
  const step = context._info.steps[params.index];
  try {
    const tools = step.tool;
    const { tools_name, tools_struct } = filterValidTools(tools) || {};
    if (tools_name) {
      const payload = renderCallPayload(params, tools_struct, context, onStream);
      const opt = {};
      const exposure_vars = ['JINA_API_KEY'];
      exposure_vars.forEach((i) => (opt[i] = context.USER_CONFIG[i]));
      const stopLoopType = ['web_crawler'];
      let chatPromise = Promise.resolve();
      while (call_times < ENV$1.FUNC_LOOP_TIMES && payload.body.tools?.length > 0) {
        const start_time = Date.now();
        call_times += 1;
        const llm_content = await functionCallWithLLM(context, payload, tools_name);
        if (!Array.isArray(llm_content)) {
          return { call_times, llm_content, func_results };
        }
        step.setCallInfo(((Date.now() - start_time) / 1000).toFixed(1) + 's', 'c_t');
        setTimeout(() => {
          chatPromise = sendMessageToTelegramWithContext(context)(`\`call ${llm_content[0].name}\``);
        }, 0);
        const func_result = await functionExec(llm_content, step, opt);
        const func_type = ENV$1.TOOLS[llm_content[0].name].type;
        func_results.push({ type: func_type, content: func_result });
        trimPayload(payload, func_results, func_type);
        if (stopLoopType.includes(func_type)) break;
      }
      await chatPromise;
    }
    return { call_times, func_results };
  } catch (e) {
    console.error(e.message);
    let errorMsg = e.message;
    if (e.name === 'AbortError') {
      errorMsg = 'call timeout';
    }
    step.setCallInfo(`⚠️${errorMsg.slice(0,50)}`);
    return { call_times, message: e.message, func_results };
  }
}
function renderCallPayload(params, tools_structs, context, onStream) {
  const { url, header, prompt, body } = params;
  let call_url = url;
  if (context.USER_CONFIG.FUNCTION_CALL_BASE) {
    call_url = context.USER_CONFIG.FUNCTION_CALL_BASE + '/chat/completions';
  }
  const call_key = context.USER_CONFIG.FUNCTION_CALL_API_KEY;
  const call_headers = { ...header, ...((call_key && { Authorization: `Bearer ${call_key}` }) || {}) };
  const options = {
    fullContentExtractor: (d) => {
      return d.choices?.[0]?.message;
    },
  };
  const call_body = {
    model: context.USER_CONFIG.FUNCTION_CALL_MODEL,
    tools: tools_structs,
    tool_choice: 'auto',
    ...tools_settings.default.extra_params,
    messages: [...body.messages],
    stream: !!(context.USER_CONFIG.FUNCTION_REPLY_ASAP && onStream),
    ...(context.USER_CONFIG.ENABLE_SHOWTOKEN && { stream_options: { include_usage: true } }),
  };
  let streamHandler = null;
  if (context.USER_CONFIG.FUNCTION_REPLY_ASAP) {
    delete call_body['max_tokens'];
    streamHandler = onStream;
  }
  const tool_prompt = tools_settings.default.prompt;
  if (prompt) call_body.messages.shift();
  call_body.messages.unshift({ role: 'system', content: tool_prompt });
  return { url: call_url, header: call_headers, body: call_body, streamHandler, options };
}
function renderAfterCallPayload(context, body, func_results, prompt) {
  if (func_results.length ===0) return;
  const last_tool_type = func_results.at(-1).type;
  const tool_prompt = tools_settings[last_tool_type].prompt;
  if (tool_prompt) {
    if (prompt) {
      body.messages[0].content = tool_prompt;
    } else body.messages.unshift({ role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: tool_prompt });
  }
  if (func_results.length > 0) {
    for (const { type, content } of func_results) {
      body.messages.at(-1).content += '\n\n' + tools_settings[type].render(content.join('\n\n'));
    }
  }
  for (const [key, value] of Object.entries((tools_settings[last_tool_type]?.extra_params) || {})) {
    body[key] = value;
  }
}
function filterValidTools(tools) {
  const valid_tools = tools.filter((i) => Object.keys(ENV$1.TOOLS).includes(i));
  if (valid_tools.length > 0) {
    const tools_struct = valid_tools.map((tool) => {
      return {
        'type': 'function',
        'function': ENV$1.TOOLS[tool].schema,
        'strict': true,
      };
    });
    return {tools_name: valid_tools, tools_struct};
  }
}
async function functionCallWithLLM(context, payload, tools_name) {
  const { url, header, body, streamHandler, options } = payload;
  const llm_resp = await requestChatCompletions(url, header, body, context, streamHandler, null, options);
  if (!llm_resp.tool_calls) {
    return llm_resp.content;
  }
  const valid_calls = llm_resp?.tool_calls?.filter((i) => tools_name.includes(i.function.name));
  if (valid_calls.length === 0) return llm_resp.content;
  return valid_calls.map((func) => ({
    name: func.function.name,
    args: JSON.parse(func.function.arguments),
  }));
}
async function functionExec(funcList, step, opt) {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutId = null;
  const INFO_LENGTH_LIMIT = 80;
  if (ENV$1.FUNC_TIMEOUT > 0) {
    timeoutId = setTimeout(() => controller.abort(), ENV$1.FUNC_TIMEOUT * 1e3);
  }
  let exec_times = ENV$1.CON_EXEC_FUN_NUM;
  const funcPromise = [];
  for (const { name, args } of funcList) {
    if (exec_times <= 0) break;
    const args_i = Object.values(args).join();
    step.setCallInfo(`${name}:${args_i.length > INFO_LENGTH_LIMIT ? args_i.slice(0, INFO_LENGTH_LIMIT) : args_i}`, 'f_i');
    console.log('start use function: ', name);
    const params = args;
    if (ENV$1.TOOLS[name].need) {
      params.keys = opt[ENV$1.TOOLS[name].need];
    }
    funcPromise.push(ENV$1.TOOLS[name].func(params, signal));
    exec_times--;
  }
  const func_resp = await raceTimeout(funcPromise);
  if (timeoutId) clearTimeout(timeoutId);
  const func_time = [];
  const content = func_resp.map((r) => {
    func_time.push(r.time || '');
    return r.content || r || '';
  });
  console.log('func call content: ', content.join('\n\n').substring(0, 500));
  if (func_time.join('').trim()) step.setCallInfo(func_time.join(), 'f_t');
  if (!content.join('').trim()) {
    step.setCallInfo(`func call response is none or timeout.`);
    throw new Error('None response in func call.');
  }
  return content;
}
function trimPayload(payload, func_results, func_type) {
  const render = tools_settings[func_type].render;
  const all_content = func_results.map(i => i.content).join('\n\n').trim();
  payload.body.messages.push({
    role: 'user',
    content: render?.(all_content) || all_content,
  });
  payload.body.tools = payload.body.tools.filter((t) => ENV$1.TOOLS[t.function.name].type !== func_type);
}
async function raceTimeout(promises, ms = ENV$1.FUNC_TIMEOUT * 1e3) {
  if (ms <= 0) return Promise.all(promises);
  return Promise.all(promises.map((p) => Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]))).then(
    (results) => results.filter(Boolean),
  );
}

class Cache {
    constructor() {
        this.maxItems = 10;
        this.maxAge = 1000 * 60 * 60;
        this.cache = {};
    }
    set(key, value) {
        this.trim();
        this.cache[key] = {
            value,
            time: Date.now(),
        };
    }
    get(key) {
        this.trim();
        return this.cache[key]?.value;
    }
    trim() {
        let keys = Object.keys(this.cache);
        for (const key of keys) {
            if (Date.now() - this.cache[key].time > this.maxAge) {
                delete this.cache[key];
            }
        }
        keys = Object.keys(this.cache);
        if (keys.length > this.maxItems) {
            keys.sort((a, b) => this.cache[a].time - this.cache[b].time);
            for (let i = 0; i < keys.length - this.maxItems; i++) {
                delete this.cache[keys[i]];
            }
        }
    }
}

const IMAGE_CACHE = new Cache();
async function fetchImage(url) {
    if (IMAGE_CACHE[url]) {
        return IMAGE_CACHE.get(url);
    }
    return fetch(url)
        .then(resp => resp.arrayBuffer())
        .then(blob => {
            IMAGE_CACHE.set(url, blob);
            return blob;
        });
}
async function uploadImageToTelegraph(url) {
  try {
    if (url.startsWith('https://telegra.ph')) {
      return url;
    }
    const raw = await (await fetch(url)).blob();
    const formData = new FormData();
    formData.append('file', raw, 'blob');
    const resp = await fetch('https://telegra.ph/upload', {
      method: 'POST',
      body: formData,
    });
      let [{ src }] = await resp.json();
      if (!src) {
          return url;
      }
    src = `https://telegra.ph${src}`;
    IMAGE_CACHE.set(url, raw);
    return src;
  } catch (e) {
    console.error(e);
    return url;
  }
}
async function urlToBase64String(url) {
    try {
        const {Buffer} = await import('node:buffer');
        return fetchImage(url)
            .then(buffer => Buffer.from(buffer).toString('base64'));
    } catch {
        return fetchImage(url)
            .then(buffer => btoa(String.fromCharCode.apply(null, new Uint8Array(buffer))));
    }
}
function getImageFormatFromBase64(base64String) {
    const firstChar = base64String.charAt(0);
    switch (firstChar) {
        case '/':
            return 'jpeg';
        case 'i':
            return 'png';
        case 'R':
            return 'gif';
        case 'U':
            return 'webp';
        default:
            throw new Error('Unsupported image format');
    }
}
async function imageToBase64String(url) {
    const base64String = await urlToBase64String(url);
    const format = getImageFormatFromBase64(base64String);
    return {
        data: base64String,
        format: `image/${format}`
    };
}
function renderBase64DataURI(params) {
    return `data:${params.format};base64,${params.data}`;
}

function openAIKeyFromContext(context) {
  const length = context.USER_CONFIG.OPENAI_API_KEY.length;
    return context.USER_CONFIG.OPENAI_API_KEY[Math.floor(Math.random() * length)];
}
function isOpenAIEnable(context) {
    return context.USER_CONFIG.OPENAI_API_KEY.length > 0;
}
function isLLMEnable(agent) {
  return (context) => {
    switch (agent) {
      case 'silicon':
      case 'deepseek':
        return !!context.USER_CONFIG.PROVIDERS[agent];
      default:
        return false;
    }
  };
}
async function renderOpenAIMessage(item) {
    const res = {
        role: item.role,
        content: item.content,
    };
    if (item.images && item.images.length > 0) {
        res.content = [];
        res.content.push({type: 'text', text: item.content || '请解读这张图'});
        for (const image of item.images) {
          switch (ENV$1.TELEGRAM_IMAGE_TRANSFER_MODE) {
            case 'base64':
              res.content.push({
                type: 'image_url',
                image_url: { url: renderBase64DataURI(await imageToBase64String(image)) },
              });
              break;
            case 'url':
            default:
              res.content.push({ type: 'image_url', image_url: { url: image } });
              break;
          }
        }
    }
    return res;
}
const openaiLikeSupportType = {
  openai: ['text2text', 'text2image', 'image2text', 'audio2text'],
  deepseek: ['text2text'],
  silicon: ['text2text', 'text2image', 'image2image'],
};
function openaiLikeAgent(context, type, index) {
  const userConfig = context.USER_CONFIG;
  if (context._info.steps.length === 0) {
    if (type === 'text2image') {
      context._info.chains = [{ chain_type: 'text:image' }];
    } else {
      context._info.chains = [{ chain_type: 'text:text' }];
    }
    context._info.initStep(0, context._info.file);
  }
  index = index ?? context._info.index;
  const agent = context._info.steps[index].agent;
  let config = {
    url: userConfig.OPENAI_API_BASE,
    key: openAIKeyFromContext(context),
    model: context._info.steps[index].model,
  };
  let like_model = null;
  let like_url = userConfig.PROVIDERS[agent]?.base_url;
  switch (type) {
    case 'text2image':
      like_model = userConfig.IMAGE_MODEL;
      break;
    case 'image2text':
      like_model = userConfig.VISION_MODEL;
      break;
    case 'audio2text':
      like_model = userConfig.STT_MODEL;
      break;
    case 'text2text':
      like_model = userConfig.CHAT_MODEL;
      break;
    case 'image2image':
      like_model = userConfig.I2I_MODEL;
      break;
  }
  if (!openaiLikeSupportType[agent]?.includes(type) || !isLLMEnable(agent)(context)) {
    if (openaiLikeSupportType.openai.includes(type)) {
      return renderOpenaiLikeUrl(agent, type, config);
    } else throw new Error(`default agent not support ${type}`);
  }
  if (!like_model) {
    throw new Error(`${agent} ${type} model is not exist`);
  }
  if (context._info?.provider?.url && context._info?.provider?.key) {
    config.url = context._info?.provider()?.url;
    config.key = context._info?.provider()?.key;
    return renderOpenaiLikeUrl(agent, type, config);
  }
  switch (agent) {
    case 'deepseek':
    case 'silicon':
      if (userConfig.PROVIDERS[agent]?.key && like_url) {
        config = { key: userConfig.PROVIDERS[agent].key, url: like_url, model: like_model };
      }
  }
  return renderOpenaiLikeUrl(agent, type, config);
}
function renderOpenaiLikeUrl(agent, type,  agentDetail) {
  switch (type) {
    case 'text2text':
    case 'image2text':
      agentDetail.url += '/chat/completions';
      break;
    case 'text2image':
      if (agent === 'silicon') {
        agentDetail.url += '/' + agentDetail.model + '/text-to-image';
      } else agentDetail.url += '/images/generations';
      break;
    case 'audio2text':
      agentDetail.url += '/audio/transcriptions';
      break;
    case 'image2image':
      if (agent === 'silicon') {
        agentDetail.url += agentDetail.model + '/image-to-image';
      }
      break;
  }
  return agentDetail;
}
async function requestCompletionsFromOpenAI(params, context, onStream) {
  const {message, images, prompt, history, extra, index} = params;
  const { url, key, model } = openaiLikeAgent(context, images && images.length > 0 ? 'image2text' : 'text2text', index);
  const header = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
  const messages = [...(history || []), {role: 'user', content: message, images}];
  if (prompt) {
    messages.unshift({ role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: prompt });
  }
  const extra_params = context.USER_CONFIG.OPENAI_API_EXTRA_PARAMS;
  const body = {
    model,
    ...extra_params,
    ...(extra || {}),
    messages: await Promise.all(messages.map(renderOpenAIMessage)),
    stream: onStream != null,
    ...(context.USER_CONFIG.ENABLE_SHOWTOKEN && { stream_options: { include_usage: true } }),
  };
  if (message && !images && context._info.steps[index]?.tool?.length > 0) {
    const result = await handleOpenaiFunctionCall({ url, header, body, prompt, index }, context, onStream);
    if (result.llm_content && !Array.isArray(result.llm_content) && context.USER_CONFIG.FUNCTION_REPLY_ASAP) {
      return result.llm_content;
    }
    renderAfterCallPayload(context, body, result.func_results, prompt);
    if (result.func_results.length > 0) {
      const resp_obj = { q: body.messages.at(-1).content };
      resp_obj.a = await requestChatCompletions(url, header, body, context, onStream);
      return resp_obj;
    }
  }
  return requestChatCompletions(url, header, body, context, onStream);
}
async function requestImageFromOpenAI(params, context) {
  const { message, extra_params } = params;
  const { url, key, model } = openaiLikeAgent(context, 'text2image', params.index);
  const header = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
  const body = {
    prompt: message,
    n: 1,
    size: context.USER_CONFIG.DALL_E_IMAGE_SIZE,
    model: model,
    ...(extra_params || {}),
  };
  if (['silicon'].includes(context.USER_CONFIG.AI_IMAGE_PROVIDER)) {
    delete body.model;
    delete body.n;
    body.batch_size = 4;
  } else if (body.model === 'dall-e-3') {
    body.quality = context.USER_CONFIG.DALL_E_IMAGE_QUALITY;
    body.style = context.USER_CONFIG.DALL_E_IMAGE_STYLE;
  }
  return { url, header, body };
}
async function requestTranscriptionFromOpenAI(audio, file_name, context) {
  const { url, key, model } = openaiLikeAgent(context, 'audio2text');
  const header = {
    'Authorization': `Bearer ${key}`,
    'Accept': 'application/json',
  };
  const formData = new FormData();
  formData.append('file', audio, file_name);
  formData.append('model', model);
  if (context.USER_CONFIG.OPENAI_STT_EXTRA_PARAMS) {
    Object.entries(context.USER_CONFIG.OPENAI_STT_EXTRA_PARAMS).forEach(([k, v]) => {
      formData.append(k, v);
    });
  }
  formData.append('response_format', 'json');
  let resp = await fetch(url, {
    method: 'POST',
    headers: header,
    body: formData,
    redirect: 'follow',
  }).catch(e => {
    console.error(e.message);
    return { ok: false, message: e.message };
  });
  if (resp.ok) {
    resp = await resp.json();
    if (!resp?.text) {
      console.error(JSON.stringify(resp));
      throw new Error(JSON.stringify(resp));
    }
    console.log(`Transcription: ${resp.text}`);
    return { ok: !resp.error, type: 'text', content: resp.text, message: resp.error };
  } else {
    return { ok: false, message: resp.statusText };
  }
}

async function run(model, body, id, token) {
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${model}`,
    header: { Authorization: `Bearer ${token}` },
    body,
  };
}
function isWorkersAIEnable(context) {
    return !!(context.USER_CONFIG.CLOUDFLARE_ACCOUNT_ID && context.USER_CONFIG.CLOUDFLARE_TOKEN);
}
function renderWorkerAIMessage(item) {
    return {
        role: item.role,
        content: item.content,
    };
}
async function requestCompletionsFromWorkersAI(params, context, onStream) {
    const {message, prompt, history} = params;
    const id = context.USER_CONFIG.CLOUDFLARE_ACCOUNT_ID;
    const token = context.USER_CONFIG.CLOUDFLARE_TOKEN;
    const model = context.USER_CONFIG.WORKERS_CHAT_MODEL;
    const url = `https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${model}`;
    const header = {
        Authorization: `Bearer ${token}`
    };
    const messages = [...(history || []), {role: 'user', content: message}];
    if (prompt) {
        messages.unshift({role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: prompt});
    }
    const body = {
        messages: messages.map(renderWorkerAIMessage),
        stream: onStream !== null,
    };
    const options = {};
    options.contentExtractor = function (data) {
        return data?.response;
    };
    options.fullContentExtractor = function (data) {
        return data?.result?.response;
    };
    options.errorExtractor = function (data) {
        return data?.errors?.[0]?.message;
    };
    return requestChatCompletions(url, header, body, context, onStream, null, options);
}
async function requestImageFromWorkersAI(params, context) {
    const id = context.USER_CONFIG.CLOUDFLARE_ACCOUNT_ID;
    const token = context.USER_CONFIG.CLOUDFLARE_TOKEN;
    const model = context.USER_CONFIG.WORKERS_IMAGE_MODEL;
    const { message, extra_params } = params;
    return run(model, { prompt: message, ...(extra_params || {}) }, id, token);
}

function isGeminiAIEnable(context) {
    return !!(context.USER_CONFIG.GOOGLE_API_KEY);
}
const GEMINI_ROLE_MAP = {
    'assistant': 'model',
    'system': 'user',
    'user': 'user',
};
function renderGeminiMessage(item) {
    return {
        role: GEMINI_ROLE_MAP[item.role],
        parts: [
            {
                'text': item.content || '',
            },
        ],
    };
}
async function requestCompletionsFromGeminiAI(params, context, onStream) {
    const {message, prompt, history} = params;
    onStream = null;
    const model = context.USER_CONFIG.GOOGLE_COMPLETIONS_MODEL;
    const url = `${context.USER_CONFIG.GOOGLE_COMPLETIONS_API}${model}:${
        onStream ? 'streamGenerateContent' : 'generateContent'
        }?key=${context.USER_CONFIG.GOOGLE_API_KEY}`;
    const contentsTemp = [...history || []];
    if (prompt) {
        contentsTemp.push({role: 'assistant', content: prompt});
    }
    contentsTemp.push({ role: 'user', content: message });
    const contents = [];
    for (const msg of contentsTemp) {
        msg.role = GEMINI_ROLE_MAP[msg.role];
        if (contents.length === 0 || contents[contents.length - 1].role !== msg.role) {
            contents.push(renderGeminiMessage(msg));
        } else {
            contents[contents.length - 1].parts[0].text += msg.content;
        }
    }
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contents }),
    });
    const data = await resp.json();
    try {
        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error(e);
        if (!data) {
            throw new Error('Empty response');
        }
        throw new Error(data?.error?.message || JSON.stringify(data));
    }
}

function isMistralAIEnable(context) {
    return !!(context.USER_CONFIG.MISTRAL_API_KEY);
}
async function requestCompletionsFromMistralAI(params, context, onStream) {
    const {message, prompt, history} = params;
    const url = `${context.USER_CONFIG.MISTRAL_API_BASE}/chat/completions`;
    const header = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${context.USER_CONFIG.MISTRAL_API_KEY}`,
    };
    const messages = [...(history || []), {role: 'user', content: message}];
    const model = context.USER_CONFIG.MISTRAL_CHAT_MODEL;
    if (prompt) {
        messages.unshift({role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: prompt});
    }
    const body = {
        model: model,
        messages,
        stream: onStream != null,
    };
    return requestChatCompletions(url, header, body, context, onStream);
}

function isCohereAIEnable(context) {
  return !!context.USER_CONFIG.COHERE_API_KEY;
}
const COHERE_ROLE_MAP = {
    'assistant': 'CHATBOT',
    'user': 'USER',
};
function renderCohereMessage(item) {
    return {
        role: COHERE_ROLE_MAP[item.role],
        content: item.content,
    };
}
async function requestCompletionsFromCohereAI(params, context, onStream) {
    const {message, prompt, history} = params;
    const url = `${context.USER_CONFIG.COHERE_API_BASE}/chat`;
    const header = {
        'Authorization': `Bearer ${context.USER_CONFIG.COHERE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': onStream !== null ? 'text/event-stream' : 'application/json',
    };
    let connectors = [];
    Object.entries(ENV$1.COHERE_CONNECT_TRIGGER).forEach(([id, triggers]) => {
      const result = triggers.some((trigger) => {
        const triggerRegex = new RegExp(trigger, 'i');
        return triggerRegex.test(message);
      });
      if (result) connectors.push({ id });
    });
    const body = {
      message,
      model: context.USER_CONFIG.COHERE_CHAT_MODEL,
      stream: onStream != null,
      preamble: prompt,
      chat_history: history.map(renderCohereMessage),
      ...(connectors.length && { connectors }),
    };
    if (!body.preamble) {
        delete body.preamble;
    }
  const options = {};
  options.streamBuilder = function (r, c) {
    return new Stream(r, c, null, cohereSseJsonParser);
  };
  options.contentExtractor = function (data) {
    return data?.text;
  };
  options.fullContentExtractor = function (data) {
    return data?.text;
  };
  options.errorExtractor = function (data) {
    return data?.message;
  };
  return requestChatCompletions(url, header, body, context, onStream, null, options);
}

function isAnthropicAIEnable(context) {
  return !!context.USER_CONFIG.ANTHROPIC_API_KEY;
}
async function renderAnthropicMessage(item) {
    const res = {
        role: item.role,
        content: item.content,
    };
    if (item.images && item.images.length > 0) {
        res.content = [];
        if (item.content) {
            res.content.push({ type: 'text', text: item.content });
        }
        for (const image of item.images) {
            res.content.push(await imageToBase64String(image).then(({ format, data }) => {
                return { type: 'image', source: { type: 'base64', media_type: format, data } };
            }));
        }
    }
    return res;
}
async function requestCompletionsFromAnthropicAI(params, context, onStream) {
  const {message, images, prompt, history} = params;
  const url = `${context.USER_CONFIG.ANTHROPIC_API_BASE}/messages`;
  const model = context.USER_CONFIG.ANTHROPIC_CHAT_MODEL;
  const header = {
    'x-api-key': context.USER_CONFIG.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
    const messages = ([...(history || []), { role: 'user', content: message, images }]);
    if (messages.length > 0 && messages[0].role === 'assistant') {
        messages.shift();
    }
  const body = {
    system: prompt,
    model,
    messages: await Promise.all(messages.map(renderAnthropicMessage)),
      stream: onStream != null,
      max_tokens: ENV$1.MAX_TOKEN_LENGTH > 0 ? ENV$1.MAX_TOKEN_LENGTH : 2048,
};
  if (!body.system) {
    delete body.system;
  }
  const options = {};
  options.streamBuilder = function (r, c) {
    return new Stream(r, c, null, anthropicSseJsonParser);
  };
  options.contentExtractor = function (data) {
    return data?.delta?.text;
  };
  options.fullContentExtractor = function (data) {
    return data?.content?.[0].text;
  };
  options.errorExtractor = function (data) {
    return data?.error?.message;
  };
  return requestChatCompletions(url, header, body, context, onStream, null, options);
}

function azureKeyFromContext(context) {
    return context.USER_CONFIG.AZURE_API_KEY;
}
function isAzureEnable(context) {
    return !!(context.USER_CONFIG.AZURE_API_KEY && context.USER_CONFIG.AZURE_PROXY_URL);
}
function isAzureImageEnable(context) {
    return !!(context.USER_CONFIG.AZURE_API_KEY && context.USER_CONFIG.AZURE_DALLE_API);
}
async function requestCompletionsFromAzureOpenAI(params, context, onStream) {
    const {message, images, prompt, history} = params;
    const url = context.USER_CONFIG.AZURE_PROXY_URL;
    const messages = [...(history || []), {role: 'user', content: message, images}];
    if (prompt) {
        messages.unshift({role: context.USER_CONFIG.SYSTEM_INIT_MESSAGE_ROLE, content: prompt});
    }
    const extra_params = context.USER_CONFIG.OPENAI_API_EXTRA_PARAMS;
    const body = {
        ...extra_params,
        messages: await Promise.all(messages.map(renderOpenAIMessage)),
        stream: onStream != null,
    };
    return requestChatCompletions(url, header, body, context, onStream);
}
async function requestImageFromAzureOpenAI(params, context) {
    const url = context.USER_CONFIG.AZURE_DALLE_API;
    const header = {
        'Content-Type': 'application/json',
        'api-key': azureKeyFromContext(context),
    };
    const body = {
        prompt,
        n: 1,
        size: context.USER_CONFIG.DALL_E_IMAGE_SIZE,
        style: context.USER_CONFIG.DALL_E_IMAGE_STYLE,
        quality: context.USER_CONFIG.DALL_E_IMAGE_QUALITY,
    };
    const validSize = ['1792x1024', '1024x1024', '1024x1792'];
    if (!validSize.includes(body.size)) {
        body.size = '1024x1024';
    }
    return { url, header, body };
}

const chatLlmAgents = [
    {
        name: 'azure',
        enable: isAzureEnable,
        request: requestCompletionsFromAzureOpenAI,
    },
    {
        name: 'openai',
        enable: isOpenAIEnable,
        request: requestCompletionsFromOpenAI,
    },
    {
        name: 'workers',
        enable: isWorkersAIEnable,
        request: requestCompletionsFromWorkersAI,
    },
    {
        name: 'gemini',
        enable: isGeminiAIEnable,
        request: requestCompletionsFromGeminiAI,
    },
    {
        name: 'mistral',
        enable: isMistralAIEnable,
        request: requestCompletionsFromMistralAI,
    },
    {
        name: 'cohere',
        enable: isCohereAIEnable,
        request: requestCompletionsFromCohereAI,
    },
    {
        name: 'anthropic',
        enable: isAnthropicAIEnable,
        request: requestCompletionsFromAnthropicAI
    },
    {
        name: "silicon",
        enable: isLLMEnable('silicon'),
        request: requestCompletionsFromOpenAI
    },
    {
        name: "deepseek",
        enable: isLLMEnable('deepseek'),
        request: requestCompletionsFromOpenAI
    },
];
function currentChatModel(agentName, context) {
    switch (agentName) {
        case 'azure':
            try {
                const url = new URL(context.USER_CONFIG.AZURE_COMPLETIONS_API);
                return url.pathname.split('/')[3];
            } catch {
                return context.USER_CONFIG.AZURE_COMPLETIONS_API;
            }
        case 'openai':
            return context.USER_CONFIG.OPENAI_CHAT_MODEL;
        case 'workers':
            return context.USER_CONFIG.WORKERS_CHAT_MODEL;
        case 'gemini':
            return context.USER_CONFIG.GOOGLE_COMPLETIONS_MODEL;
        case 'mistral':
            return context.USER_CONFIG.MISTRAL_CHAT_MODEL;
        case 'cohere':
            return context.USER_CONFIG.COHERE_CHAT_MODEL;
        case 'anthropic':
            return context.USER_CONFIG.ANTHROPIC_CHAT_MODEL;
        default:
            return null;
    }
}
function chatModelKey(agentName) {
    switch (agentName) {
        case 'azure':
            return 'AZURE_COMPLETIONS_API';
        case 'openai':
            return 'OPENAI_CHAT_MODEL';
        case 'workers':
            return 'WORKERS_CHAT_MODEL';
        case 'gemini':
            return 'GOOGLE_COMPLETIONS_MODEL';
        case 'mistral':
            return 'MISTRAL_CHAT_MODEL';
        case 'cohere':
            return 'COHERE_CHAT_MODEL';
        case 'anthropic':
            return 'ANTHROPIC_CHAT_MODEL';
        default:
            return null;
    }
}
function customInfo(config) {
  const other_info = {
    mode: config.CURRENT_MODE,
    prompt: config.SYSTEM_INIT_MESSAGE.slice(0,20) + '...',
    'MAPPING_KEY': config.MAPPING_KEY,
    'MAPPING_VALUE': config.MAPPING_VALUE,
    'USE_TOOLS': config.USE_TOOLS,
    'FUNCTION_CALL_MODEL': config.FUNCTION_CALL_MODEL,
  };
  return JSON.stringify(other_info, null, 2);
}
function loadChatLLM(context) {
    const AI_PROVIDER = context.USER_CONFIG.AI_PROVIDER;
    for (const llm of chatLlmAgents) {
        if (llm.name === AI_PROVIDER) {
            return llm;
        }
    }
    for (const llm of chatLlmAgents) {
        if (llm.enable(context)) {
            context.USER_CONFIG.AI_PROVIDER = llm.name;
            return llm;
        }
    }
    return null;
}
const audioLlmAgents = [
    {
        name: "openai",
        enable: isOpenAIEnable,
        request: requestTranscriptionFromOpenAI
    }
];
function loadAudioLLM(context) {
    const AI_PROVIDER = context.USER_CONFIG.AI_PROVIDER;
    for (const llm of audioLlmAgents) {
        if (llm.name === AI_PROVIDER) {
            return llm;
        }
    }
    for (const llm of audioLlmAgents) {
        if (llm.enable(context)) {
            return llm;
        }
    }
    return null;
}
const imageGenAgents = [
    {
        name: 'azure',
        enable: isAzureImageEnable,
        request: requestImageFromAzureOpenAI,
    },
    {
        name: 'openai',
        enable: isOpenAIEnable,
        request: requestImageFromOpenAI,
    },
    {
        name: 'workers',
        enable: isWorkersAIEnable,
        request: requestImageFromWorkersAI
    },
    {
        name: "silicon",
        enable: isLLMEnable,
        request: requestImageFromOpenAI
    }
];
function loadImageGen(context) {
    const AI_IMAGE_PROVIDER = context.USER_CONFIG.AI_IMAGE_PROVIDER;
    for (const imgGen of imageGenAgents) {
        if (imgGen.name === AI_IMAGE_PROVIDER) {
            return imgGen;
        }
    }
    for (const imgGen of imageGenAgents) {
        if (imgGen.enable(context)) {
            return imgGen;
        }
    }
    return null;
}
function currentImageModel(agentName, context) {
    switch (agentName) {
        case 'azure':
            try {
                const url = new URL(context.USER_CONFIG.AZURE_DALLE_API);
                return url.pathname.split('/')[3];
            } catch {
                return context.USER_CONFIG.AZURE_DALLE_API;
            }
        case "openai":
            return context.USER_CONFIG.OPENAI_IMAGE_MODEL;
        case "workers":
            return context.USER_CONFIG.WORKERS_IMAGE_MODEL;
        default:
            return null;
    }
}
function imageModelKey(agentName) {
    switch (agentName) {
        case 'azure':
            return 'AZURE_DALLE_API';
        case 'openai':
            return 'DALL_E_MODEL';
        case 'workers':
            return 'WORKERS_IMAGE_MODEL';
        default:
            return null;
    }
}

const TemplateInputTypeJson = 'json';
const TemplateInputTypeSpaceSeparated = 'space-separated';
const TemplateInputTypeCommaSeparated = 'comma-separated';
const TemplateBodyTypeJson = 'json';
const TemplateBodyTypeForm = 'form';
const TemplateResponseTypeJson = 'json';
const TemplateResponseTypeText = 'text';
const TemplateOutputTypeText = 'text';
const TemplateOutputTypeImage = 'image';
const TemplateOutputTypeHTML = 'html';
const TemplateOutputTypeMarkdown = 'markdown';
const TemplateOutputTypeMarkdownV2 = 'MarkdownV2';

const INTERPOLATE_LOOP_REGEXP = /\{\{#each(?::(\w+))?\s+(\w+)\s+in\s+([\w.[\]]+)\}\}([\s\S]*?)\{\{\/each(?::\1)?\}\}/g;
const INTERPOLATE_CONDITION_REGEXP = /\{\{#if(?::(\w+))?\s+([\w.[\]]+)\}\}([\s\S]*?)(?:\{\{#else(?::\1)?\}\}([\s\S]*?))?\{\{\/if(?::\1)?\}\}/g;
const INTERPOLATE_VARIABLE_REGEXP = /\{\{([\w.[\]]+)\}\}/g;
function evaluateExpression(expr, localData) {
    if (expr === '.') {
        return localData['.'] ?? localData;
    }
    try {
        return expr.split('.').reduce((value, key) => {
            if (key.includes('[') && key.includes(']')) {
                const [arrayKey, indexStr] = key.split('[');
                const indexExpr = indexStr.slice(0, -1);
                let index = Number.parseInt(indexExpr, 10);
                if (Number.isNaN(index)) {
                    index = evaluateExpression(indexExpr, localData);
                }
                return value?.[arrayKey]?.[index];
            }
            return value?.[key];
        }, localData);
    } catch (error) {
        console.error(`Error evaluating expression: ${expr}`, error);
        return undefined;
    }
}
function interpolate(template, data, formatter = null) {
    const processConditional = (condition, trueBlock, falseBlock, localData) => {
        const result = evaluateExpression(condition, localData);
        return result ? trueBlock : (falseBlock || '');
    };
    const processLoop = (itemName, arrayExpr, loopContent, localData) => {
        const array = evaluateExpression(arrayExpr, localData);
        if (!Array.isArray(array)) {
            console.warn(`Expression "${arrayExpr}" did not evaluate to an array`);
            return '';
        }
        return array.map((item) => {
            const itemData = { ...localData, [itemName]: item, '.': item };
            return interpolate(loopContent, itemData);
        }).join('');
    };
    const processTemplate = (tmpl, localData) => {
        tmpl = tmpl.replace(INTERPOLATE_LOOP_REGEXP, (_, alias, itemName, arrayExpr, loopContent) =>
            processLoop(itemName, arrayExpr, loopContent, localData));
        tmpl = tmpl.replace(INTERPOLATE_CONDITION_REGEXP, (_, alias, condition, trueBlock, falseBlock) =>
            processConditional(condition, trueBlock, falseBlock, localData));
        return tmpl.replace(INTERPOLATE_VARIABLE_REGEXP, (_, expr) => {
            const value = evaluateExpression(expr, localData);
            if (value === undefined) {
                return `{{${expr}}}`;
            }
            if (formatter) {
                return formatter(value);
            }
            return String(value);
        });
    };
    return processTemplate(template, data);
}

function interpolateObject(obj, data) {
    if (obj === null || obj === undefined) {
        return null;
    }
    if (typeof obj === 'string') {
        return interpolate(obj, data);
    }
    if (Array.isArray(obj)) {
        return obj.map(item => interpolateObject(item, data));
    }
    if (typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = interpolateObject(value, data);
        }
        return result;
    }
    return obj;
}
async function executeRequest(template, data) {
    const urlRaw = interpolate(template.url, data, encodeURIComponent);
    const url = new URL(urlRaw);
    if (template.query) {
        for (const [key, value] of Object.entries(template.query)) {
            url.searchParams.append(key, interpolate(value, data));
        }
    }
    const method = template.method;
    const headers = Object.fromEntries(
        Object.entries(template.headers || {}).map(([key, value]) => {
            return [key, interpolate(value, data)];
        }),
    );
    for (const key of Object.keys(headers)) {
        if (headers[key] === null) {
            delete headers[key];
        }
    }
    let body = null;
    if (template.body) {
        if (template.body.type === TemplateBodyTypeJson) {
            body = JSON.stringify(interpolateObject(template.body.content, data));
        } else if (template.body.type === TemplateBodyTypeForm) {
            body = new URLSearchParams();
            for (const [key, value] of Object.entries(template.body.content)) {
                body.append(key, interpolate(value, data));
            }
        } else {
            body = interpolate(template.body.content, data);
        }
    }
    const response = await fetch(url, {
        method,
        headers,
        body,
    });
    const renderOutput = async (type, temple, response) => {
        switch (type) {
            case TemplateResponseTypeText:
                return interpolate(temple, await response.text());
            case TemplateResponseTypeJson:
            default:
                return interpolate(temple, await response.json());
        }
    };
    if (!response.ok) {
        const content = await renderOutput(template.response?.error?.input_type, template.response.error?.output, response);
        return {
            type: template.response.error.output_type,
            content,
        };
    }
    let content = await renderOutput(template.response.content?.input_type, template.response.content?.output, response);
    if (template.response?.render) {
        content = template.response.render.replace('{{input}}', data.DATA).replace('{{output}}', content);
    }
    return {
        type: template.response.content.output_type,
        content,
    };
}
function formatInput(input, type) {
    if (type === TemplateInputTypeJson) {
        return JSON.parse(input);
    } else if (type === TemplateInputTypeSpaceSeparated) {
        return input.split(/\s+/);
    } else if (type === TemplateInputTypeCommaSeparated) {
        return input.split(/\s*,\s*/);
    } else {
        return input;
    }
}

async function requestI2IHander(context, params) {
  const agent = context.USER_CONFIG.AI_IMAGE_PROVIDER;
  const handlers = {
    'silicon': requestImage2ImageFromSilicon
  };
  return await (handlers[agent] || handlers['silicon'])(params, context);
}
async function requestImage2ImageFromSilicon(params, context) {
  const { prompt, images, batch_size, size, extra_params = {} } = params;
  const { style_name, num_inference_steps } = extra_params;
  const { url, key, model } = openaiLikeAgent(context, 'image2image');
  const body = {
    prompt,
    image: images[0],
    image_size: size,
    num_inference_steps: num_inference_steps || defaultParams.num_inference_steps,
    batch_size: batch_size || defaultParams.batch_size,
  };
  const header = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
  if (model.startsWith('stabilityai') || model.startsWith('ByteDance')) {
    body.guidance_scale = 7.5;
  } else if (model.startsWith('InstantX')) {
    delete body.image;
    delete body.image_size;
    delete body.batch_size;
    body.face_image = images[0];
    body.pose_image = images[1];
    body.style_name = style_name || 'Film Noir';
  } else if (model.startsWith('TencentARC')) {
    body.style_name = style_name || 'Photographic';
    body.guidance_scale = 5;
  } else if (model.startsWith('BeijingUltimatech')) {
    delete body.image;
    body.room_image = images[0];
    body.reference_style_image = images[1];
  } else throw new Error('unsupported model');
  return await requestImage2Image(url, header, body, context);
}
async function requestImage2Image(url, header, body, context) {
  const controller = new AbortController();
  const { signal } = controller;
  let timeoutID = null;
  if (ENV.CHAT_COMPLETE_API_TIMEOUT > 0) {
    timeoutID = setTimeout(() => controller.abort(), ENV.CHAT_COMPLETE_API_TIMEOUT * 1e3);
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: header,
    body: body,
    signal,
  }).then(r => r.json());
  if (timeoutID) {
    clearTimeout(timeoutID);
  }
  if (resp.images && resp.images.length > 0) {
    return renderPic2PicResult(context, resp);
  } else {
    console.log(JSON.stringify(resp));
    throw new Error('No images return');
  }}
async function requestText2Image(context, params) {
  const gen = loadImageGen(context)?.request;
  if (!gen) {
    return sendMessageToTelegramWithContext(context)(`ERROR: Image generator not found`, 'tip');
  }
  setTimeout(() => {
    sendMessageToTelegramWithContext(context)('It may take a while, please wait.', 'tip').catch(console.error);
  }, 0);
  console.log('start generate image.');
  const {url, header, body} = await gen(params, context);
  const resp = fetch(url, {
    method: 'POST',
    headers: header,
    body: JSON.stringify(body),
  });
  const result = await renderText2PicResult(context, resp);
  return sendPhotoToTelegramWithContext(context)(result);
}
const defaultParams = {
  batch_size: 1,
  num_inference_steps: 20,
  stabilityai: {
    image_size: ['1024x1024', '1024x2048', '1536x1024', '1536x2048', '1152x2048', '2048x1152'],
  }
};
async function renderText2PicResult(context, response) {
  let resp = null;
  switch (context.USER_CONFIG.AI_IMAGE_PROVIDER) {
    case 'openai':
    case 'auto':
    case 'azure':
      resp = await response.then(r => r.json());
      if (resp.error?.message) {
        throw new Error(resp.error.message);
      }
      return {
        type: "image",
        url: resp?.data?.map((i) => i?.url),
        text: resp?.data?.[0]?.revised_prompt || '',
      };
    case 'silicon':
      resp = await response.then(async (r) => {
        if (r.status !== 200) return { message: await r.text() };
        return r.json();
      });
      if (resp.message) {
        throw new Error(resp.message);
      }
      return { type: 'image', url: (await resp?.images)?.map((i) => i?.url) };
    case "worksai":
      resp = await response.then(r => r.blob());
      return { type: 'image', url: [resp] };
    default:
      return sendMessageToTelegramWithContext(context)('unsupported agent');
  }
}
function renderPic2PicResult(context, resp) {
  switch (context.USER_CONFIG.AI_IMAGE_PROVIDER) {
    case 'silicon':
      return { type: 'image', url: resp?.images?.map(i => i?.url), message: resp.message };
  }
}

async function extractMessageType$1(message, currentBotId) {
  let msg = message;
  const acceptMsgType = ENV$1.ENABLE_FILE ? ['document', 'photo', 'image', 'voice', 'audio', 'text'] : ['text'];
  let msgType = acceptMsgType.find((key) => key in msg);
  let message_text = message.text ?? message.caption;
  if (ENV$1.EXTRA_MESSAGE_CONTEXT && (message.reply_to_message?.text || message.reply_to_message?.caption) && message.reply_to_message?.from?.id !== +currentBotId) {
    message_text =
      '> ' + (message.reply_to_message.text || '') + (message.reply_to_message?.caption || '') + '\n' + message_text;
  }
  if (msgType === 'text' && message.reply_to_message && ENV$1.EXTRA_MESSAGE_CONTEXT) {
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
    if (ENV$1.TELEGRAM_PHOTO_SIZE_OFFSET >= 0) {
      sizeIndex = ENV$1.TELEGRAM_PHOTO_SIZE_OFFSET;
    } else if (ENV$1.TELEGRAM_PHOTO_SIZE_OFFSET < 0) {
      sizeIndex = msg.photo.length + ENV$1.TELEGRAM_PHOTO_SIZE_OFFSET;
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
async function getTelegramFileUrl(file, botToken) {
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
  if (ENV$1.TELEGRAPH_IMAGE_ENABLE && type === 'image') {
    const promises = [];
    for (const url of file_urls) {
      promises.push(uploadImageToTelegraph(url));
    }
    file_urls = await Promise.all(promises);
  }
  console.log('file url:\n' + file_urls.join('\n'));
  return file_urls;
}
async function handleFile(file) {
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
class MiddleInfo {
  constructor(USER_CONFIG, msg_info) {
    this.chain_start_time = Date.now();
    const msgType = msg_info.type || 'text';
    const mode_detail = USER_CONFIG.MODES[USER_CONFIG.CURRENT_MODE]?.[msgType];
    this.is_concurrent = mode_detail?.type === 'concurrent';
    this.chains = mode_detail?.chains || [{}];
    this._bp_config = { ...USER_CONFIG };
    this.file = {
      type: 'text',
      id: [],
      text: '',
      ...msg_info,
    };
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
    const msg_info = await extractMessageType$1(message, context.SHARE_CONTEXT.currentBotId);
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
    const stepInfo = ENV$1.HIDE_MIDDLE_MESSAGE ? '' : this.step_info && `[STEP ${this.step_info}]\n`;
    const time = ((Date.now() - this.chain_start_time) / 1000).toFixed(1);
    let call_info = '';
    if (ENV$1.CALL_INFO) call_info = (this.call_info && this.call_info + '\n').replace('$$f_t$$', '');
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
    if ('IMAGE' === chatType) {
      this.agent = chain.agent || config.AI_IMAGE_PROVIDER;
    } else {
      this.agent = chain.agent || config.AI_PROVIDER;
    }
    let model_type = '';
    if (['deepseek', 'silicon'].includes(this.agent)) {
      model_type = `${chatType}_MODEL`;
    } else model_type = `${this.agent.toUpperCase()}_${chatType}_MODEL`;
    this.model =
      chain.model || config[model_type] || config[`OPENAI_${chatType}_MODEL`];
    if (chain.prompt) {
      this.prompt = ENV$1.PROMPT[chain.prompt] ?? chain.prompt;
    } else this.prompt = config.SYSTEM_INIT_MESSAGE;
    this.provider = chain.provider;
    this.history = chain.history ?? config.MAX_HISTORY_LENGTH;
    this.show_info = chain.show_info ?? config.ENABLE_SHOWINFO;
    this.tool = chain.tool ?? config.USE_TOOLS;
    return this;
  }
}

function tokensCounter() {
  return (text) => {
    return text.length;
  };
}
async function loadHistory(key, MAX_HISTORY_LENGTH = ENV$1.MAX_HISTORY_LENGTH) {
  let history = [];
  try {
    history = JSON.parse((await DATABASE.get(key)) || '[]');
  } catch (e) {
    console.error(e);
  }
  if (!history || !Array.isArray(history)) {
    history = [];
  }
  const counter = tokensCounter();
  const trimHistory = (list, initLength, maxLength, maxToken) => {
    if (maxLength >= 0 && list.length > maxLength) {
      list = list.splice(list.length - maxLength);
    }
    if (maxToken > 0) {
      let tokenLength = initLength;
      for (let i = list.length - 1; i >= 0; i--) {
        const historyItem = list[i];
        let length = 0;
        if (historyItem.content) {
          length = counter(historyItem.content);
        } else {
          historyItem.content = '';
        }
        tokenLength += length;
        if (tokenLength > maxToken) {
          list = list.splice(i + 1);
          break;
        }
      }
    }
    return list;
  };
  if (ENV$1.AUTO_TRIM_HISTORY && MAX_HISTORY_LENGTH > 0) {
    history = trimHistory(history, 0, MAX_HISTORY_LENGTH, ENV$1.MAX_TOKEN_LENGTH);
  }
  return history;
}
async function requestCompletionsFromLLM(params, context, llm, modifier, onStream) {
  if (context._info.steps.length === 0) {
    context._info.initStep();
    params.index = 0;
  }
  const step = context._info?.steps[params.index];
  const historyDisable = ENV$1.AUTO_TRIM_HISTORY && step.history <= 0;
  const historyKey = context.SHARE_CONTEXT.chatHistoryKey;
  const readStartTime = performance.now();
  let history = [];
  if (!params?.images && step.history > 0) {
    history = await loadHistory(historyKey, step.history);
  }
  const readTime = ((performance.now() - readStartTime) / 1000).toFixed(2);
  console.log(`readHistoryTime: ${readTime}s`);
  if (modifier) {
    const modifierData = modifier(history, params?.message);
    history = modifierData.history;
    params.message = modifierData.message;
  }
  const llmParams = {
    ...params,
    history: history,
    prompt: step.prompt,
  };
  let answer = await llm(llmParams, context, onStream);
  if (params.images) {
    params.message = '[A IMAGE] ' + params.message;
  }
  if (typeof answer === 'object') {
    params.message = answer.q;
    answer = answer.a;
  }
  if (!historyDisable && answer) {
    history.push({ role: 'user', content: params.message || '' });
    history.push({ role: 'assistant', content: answer });
    await DATABASE.put(historyKey, JSON.stringify(history)).catch(console.error);
  }
  return answer;
}
async function chatViaFileWithLLM(context, params) {
    try {
      const { raw, file_name } = await handleFile(params.files);
      const llm = loadAudioLLM(context)?.request;
      if (llm === null) {
        return sendMessageToTelegramWithContext(context)(`LLM is not enable`);
      }
      const startTime = performance.now();
      context._info.steps[params.index].updateStartTime();
      const answer = await llm(raw, file_name, context);
      if (!answer.ok) {
        console.error(answer.message);
        return sendMessageToTelegramWithContext(context)('Chat via file failed.', 'tip');
      }
      console.log(`[FILE DONE] ${llm.name}: ${((performance.now() - startTime) / 1000).toFixed(1)}s`);
      const file_result = { type: answer.type };
      if (answer.type === 'text') {
        file_result.text = answer.content;
        if (context._info.chains.length === context._info.step || !ENV$1.HIDE_MIDDLE_MESSAGE) {
          await sendMessageToTelegramWithContext(context)(answer.content);
        }
      } else if (typeof answer.content === 'string') {
        file_result.url = [answer.content];
      } else file_result.raw = [answer.content];
      return file_result;
    } catch (e) {
      context.CURRENT_CHAT_CONTEXT.disable_web_page_preview = true;
      return sendMessageToTelegramWithContext(context)(e.message.substring(2048), 'tip');
    }
  }

function markdownToTelegraphNodes(markdown) {
  const lines = markdown.split('\n');
  const nodes = [];
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLanguage = '';
  for (let line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        nodes.push({
          tag: 'pre',
          children: [
            {
              tag: 'code',
              attrs: codeBlockLanguage ? { class: `language-${codeBlockLanguage}` } : {},
              children: [codeBlockContent.trim()],
            },
          ],
        });
        inCodeBlock = false;
        codeBlockContent = '';
        codeBlockLanguage = '';
      } else {
        inCodeBlock = true;
        codeBlockLanguage = line.trim().slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      continue;
    }
    const _line = line.trim();
    if (!_line) continue;
    if (_line.startsWith('#')) {
      let level = line.match(/^#+/)[0].length;
      level = level <= 2 ? 3 : 4;
      const text = line.replace(/^#+\s*/, '');
      nodes.push({ tag: `h${level}`, children: processInlineElements(text) });
    }
    else if (_line.startsWith("> ")) {
      const text = line.slice(2);
      nodes.push({ tag: 'blockquote', children: processInlineElements(text) });
    }
    else if (_line === '---' || _line === '***') {
    nodes.push({ tag: "hr" });
    }
    else {
      const matches = RegExp(/^(\s*)(-|\*)\s/).exec(line);
      if (matches) {
        line = matches[1] + '• ' + line.slice(matches[0].length);
      }
      nodes.push({ tag: 'p', children: processInlineElements(line) });
    }
  }
  if (inCodeBlock) {
    nodes.push({
      tag: 'pre',
      children: [
        {
          tag: 'code',
          attrs: codeBlockLanguage ? { class: `language-${codeBlockLanguage}` } : {},
          children: [codeBlockContent.trim()],
        },
      ],
    });
  }
  return nodes;
}
function processInlineElementsHelper(text) {
  let children = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  const underlineRegex = /__(.+?)__/g;
  const italicRegex = /_(.+?)_/g;
  const strikethroughRegex = /~~(.+?)~~/g;
  let tagMatch = null;
  let lastIndex = 0;
  while (
    (tagMatch =
      boldRegex.exec(text) || underlineRegex.exec(text) || italicRegex.exec(text) || strikethroughRegex.exec(text)) !==
    null
  ) {
    if (tagMatch.index > lastIndex) {
      children.push(text.slice(lastIndex, tagMatch.index));
    }
    let tag = '';
    if (tagMatch[0].startsWith('**')) {
      tag = 'strong';
    } else if (tagMatch[0].startsWith('__')) {
      tag = 'u';
    } else if (tagMatch[0].startsWith('_')) {
      tag = 'i';
    } else if (tagMatch[0].startsWith('~~')) {
      tag = 's';
    }
    children.push({
      tag: tag,
      children: [tagMatch[1]],
    });
    lastIndex = tagMatch.index + tagMatch[0].length;
    boldRegex.lastIndex = underlineRegex.lastIndex = italicRegex.lastIndex = strikethroughRegex.lastIndex = lastIndex;
  }
  if (lastIndex < text.length) {
    children.push(text.slice(lastIndex));
  }
  children = children.map((child) => {
    if (typeof child === 'string') {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let linkMatch;
      let linkChildren = [];
      let lastLinkIndex = 0;
      while ((linkMatch = linkRegex.exec(child)) !== null) {
        if (linkMatch.index > lastLinkIndex) {
          linkChildren.push(child.slice(lastLinkIndex, linkMatch.index));
        }
        linkChildren.push({
          tag: 'a',
          attrs: { href: linkMatch[2] },
          children: [linkMatch[1]],
        });
        lastLinkIndex = linkMatch.index + linkMatch[0].length;
      }
      if (lastLinkIndex < child.length) {
        linkChildren.push(child.slice(lastLinkIndex));
      }
      return linkChildren.length >= 1 ? linkChildren : child;
    }
    return child;
  });
  return children.flat();
}
function processInlineElements(text) {
  let children = [];
  const codeRegex = /`([^`]+)`/g;
  let codeMatch;
  let lastIndex = 0;
  while ((codeMatch = codeRegex.exec(text)) !== null) {
    if (codeMatch.index > lastIndex) {
      children.push(...processInlineElementsHelper(text.slice(lastIndex, codeMatch.index)));
    }
    children.push({
      tag: 'code',
      children: [codeMatch[1]],
    });
    lastIndex = codeMatch.index + codeMatch[0].length;
  }
  if (lastIndex < text.length) {
    children.push(...processInlineElementsHelper(text.slice(lastIndex)));
  }
  return children.flat();
}

async function createAccount(author) {
  const { short_name = 'Mewo', author_name = 'A Cat' } = author || {};
  const url = `https://api.telegra.ph/createAccount?short_name=${short_name}&author_name=${author_name}`;
  const resp = await fetch(url).then((r) => r.json());
  if (resp.ok) {
    return {
      access_token: resp.result.access_token,
    };
  } else throw new Error('create telegraph account failed');
}
async function createOrEditPage(sendContext, title, content, author) {
  const { url, access_token, path } = sendContext;
  const {short_name, author_name, author_url} = author;
  const body = {
    access_token,
    ...(path && { path } || {}),
    title: title || 'Daily Q&A',
    content: markdownToTelegraphNodes(content),
    short_name: short_name || "anonymous",
    author_name: author_name || "anonymous",
    ...(author_url && { author_url } || {})
  };
  const headers = { 'Content-Type': 'application/json' };
  return fetch(url, {
    method: 'post',
    headers,
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
async function sendTelegraph(context, title, content, author) {
  let endPoint = 'https://api.telegra.ph/editPage';
  let access_token = context.telegraphAccessToken;
  let path = context.telegraphPath;
  if (!access_token) {
    access_token = (await createAccount(author)).access_token;
    context.telegraphAccessToken = access_token;
    await DATABASE.put(context.telegraphAccessTokenKey, access_token);
  }
  const sendContext = { url: endPoint, access_token, path };
  if (!path) {
    sendContext.url = 'https://api.telegra.ph/createPage';
    const c_resp = await createOrEditPage(sendContext, title, content, author);
    if (c_resp.ok) {
      context.telegraphPath = c_resp.result.path;
      console.log('telegraph url: ', c_resp.result.url);
      return c_resp;
    } else { console.error(c_resp.error); throw new Error(c_resp.error); }
  } else return createOrEditPage(sendContext, title, content, author);
}
function sendTelegraphWithContext(context) {
  return async (title, content, author) => sendTelegraph(context.SHARE_CONTEXT, title, content, author);
}

async function chatWithLLM(params, context, modifier) {
    try {
      const llm = loadChatLLM(context)?.request;
      if (llm === null) {
        return sendMessageToTelegramWithContext(context)(`LLM is not enable`);
      }
      if (!context.SHARE_CONTEXT.message_id) {
        await sendInitMessage(context);
      }
      const parseMode = context.CURRENT_CHAT_CONTEXT.parse_mode;
      let onStream = null;
      let nextEnableTime = null;
      const sendMessage = sendTextMessageHandler(context, params.index);
      if (ENV$1.STREAM_MODE) {
        onStream = async (text) => {
          if (ENV$1.HIDE_MIDDLE_MESSAGE && !context._info.isLastStep)
return;
          try {
            if (nextEnableTime && nextEnableTime > Date.now()) {
              return;
            }
            if (ENV$1.TELEGRAM_MIN_STREAM_INTERVAL > 0) {
              nextEnableTime = Date.now() + ENV$1.TELEGRAM_MIN_STREAM_INTERVAL;
            }
            let send_content = text;
            if (context._info.is_concurrent) {
              context._info.steps[params.index].concurrent_content = text;
              send_content = context._info.concurrent_content;
            }
            const resp = await sendMessage(send_content);
            if (resp.status === 429) {
              const retryAfter = Number.parseInt(resp.headers.get('Retry-After'));
              if (retryAfter) {
                nextEnableTime = Date.now() + retryAfter * 1000;
                return;
              }
            }
            nextEnableTime = null;
          } catch (e) {
            console.error(e);
          }
        };
      }
      if (context._info.is_concurrent && !context._info.concurrent_stream) {
        context._info.concurrent_stream = onStream;
      }
      const onStreamSelect = context._info.concurrent_stream || onStream;
      console.log(`[START] Chat via ${llm.name}`);
      const answer = await requestCompletionsFromLLM(params, context, llm, modifier, onStreamSelect);
      if (!answer) {
        return sendMessageToTelegramWithContext(context)('None response', 'tip');
      }
      context.CURRENT_CHAT_CONTEXT.parse_mode = parseMode;
      if (ENV$1.SHOW_REPLY_BUTTON && context.CURRENT_CHAT_CONTEXT.message_id) {
        try {
          await deleteMessageFromTelegramWithContext(context)(context.CURRENT_CHAT_CONTEXT.message_id);
          context.CURRENT_CHAT_CONTEXT.message_id = null;
          context.CURRENT_CHAT_CONTEXT.reply_markup = {
            keyboard: [[{ text: '/new' }, { text: '/redo' }]],
            selective: true,
            resize_keyboard: true,
            one_time_keyboard: true,
          };
        } catch (e) {
          console.error(e);
        }
      }
      if (nextEnableTime && nextEnableTime > Date.now()) {
        console.log(`The last message need wait:${((nextEnableTime - Date.now()) / 1000).toFixed(1)}s`);
      }
      if (context._info.chains.length === context._info.step || !ENV$1.HIDE_MIDDLE_MESSAGE) {
        if (context._info.nextEnableTime) {
          console.log(`Need wait until ${new Date(nextEnableTime).toISOString()}`);
          await new Promise(resolve => setTimeout(resolve, context._info.nextEnableTime - Date.now()));
          context._info.nextEnableTime = null;
        }
        await onStreamSelect(answer);
      }
      console.log(`[DONE] Chat via ${llm.name}`);
      return { type: 'text', text: answer };
    } catch (e) {
      let errMsg = `Error: ${e.message}`;
      console.error(errMsg);
      if (errMsg.length > 2048) {
        errMsg = errMsg.substring(0, 2048);
      }
      context.CURRENT_CHAT_CONTEXT.disable_web_page_preview = true;
      return sendMessageToTelegramWithContext(context)(errMsg, 'tip');
    }
  }
  function sendTextMessageHandler(context, index) {
      const question = context._info.step?.file.text || 'Redo';
      const prefix = `#Question\n\`\`\`\n${question?.length > 400 ? `${question.slice(0, 200)}...${question.slice(-200)}` : question}\n\`\`\`\n---`;
      const author = {
        short_name: context.SHARE_CONTEXT.currentBotName,
        author_name: context.SHARE_CONTEXT.currentBotName,
        author_url: ENV$1.TELEGRAPH_AUTHOR_URL,
      };
    const step = context._info.steps[index ?? context._info.index];
      return async (text) => {
        if (
          ENV$1.TELEGRAPH_NUM_LIMIT > 0
          && text.length > ENV$1.TELEGRAPH_NUM_LIMIT
          && CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)
        ) {
          const telegraph_prefix = `${prefix}\n#Answer\n🤖 _${step.model}_\n`;
          const debug_info = `debug info:${ENV$1.CALL_INFO ? '' : `\n${step.call_info.replace('$$f_t$$', '')}\n`}`;
          const telegraph_suffix = `\n---\n\`\`\`\n${debug_info}\n${step.message_title}\n\`\`\``;
          if (!context.SHARE_CONTEXT.telegraphPath) {
            const resp = await sendTelegraphWithContext(context)(
              null,
              telegraph_prefix + text + telegraph_suffix,
              author,
            );
            const url = `https://telegra.ph/${context.SHARE_CONTEXT.telegraphPath}`;
            const msg = `回答已经转换成完整文章~\n[🔗点击进行查看](${url})`;
            const show_info_tag = context.USER_CONFIG.ENABLE_SHOWINFO;
            step.config('show_info', false);
            await sendMessageToTelegramWithContext(context)(msg);
            step.config('show_info', show_info_tag);
            return resp;
          }
          return sendTelegraphWithContext(context)(null, telegraph_prefix + text + telegraph_suffix, author);
        } else {
 return sendMessageToTelegramWithContext(context)(text);
}
      };
  }

function checkMention(content, entities, botName, botId) {
    let isMention = false;
    for (const entity of entities) {
        const entityStr = content.slice(entity.offset, entity.offset + entity.length);
        switch (entity.type) {
            case 'mention':
                if (entityStr === `@${botName}`) {
                    isMention = true;
                    content = content.slice(0, entity.offset) + content.slice(entity.offset + entity.length);
                }
                break;
            case 'text_mention':
                if (`${entity.user.id}` === `${botId}`) {
                    isMention = true;
                    content = content.slice(0, entity.offset) + content.slice(entity.offset + entity.length);
                }
                break;
            case 'bot_command':
                if (entityStr.endsWith(`@${botName}`)) {
                    isMention = true;
                    const newEntityStr = entityStr.replace(`@${botName}`, '');
                    content = content.slice(0, entity.offset) + newEntityStr + content.slice(entity.offset + entity.length);
                }
                break;
        }
    }
    return {
        isMention,
        content,
    };
}
async function getChatRoleWithContext(context) {
    const {
        chatId,
        speakerId,
        groupAdminKey,
        currentBotToken: token,
        allMemberAreAdmin,
    } = context.SHARE_CONTEXT;
    if (allMemberAreAdmin) {
        return 'administrator';
    }
    let groupAdmin;
    try {
        groupAdmin = JSON.parse(await DATABASE.get(groupAdminKey) || '[]');
    } catch (e) {
        console.error(e);
    }
    if (!groupAdmin || !Array.isArray(groupAdmin) || groupAdmin.length === 0) {
        const { result } = await getChatAdministrators(chatId, token);
        if (result == null) {
            return null;
        }
        groupAdmin = result;
        await DATABASE.put(
            groupAdminKey,
            JSON.stringify(groupAdmin),
            { expiration: (Date.now() / 1000) + 120 },
        );
    }
    for (let i = 0; i < groupAdmin.length; i++) {
        const user = groupAdmin[i];
        if (`${user.user.id}` === `${speakerId}`) {
            return user.status;
        }
    }
    return 'member';
}

const commandAuthCheck = {
  default(chatType) {
    if (CONST.GROUP_TYPES.includes(chatType)) {
      return ['administrator', 'creator'];
    }
    return null;
  },
  shareModeGroup(chatType) {
    if (CONST.GROUP_TYPES.includes(chatType)) {
      if (!ENV$1.GROUP_CHAT_BOT_SHARE_MODE) {
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
async function commandGenerateImg(message, command, subcommand, context) {
  if (!subcommand.trim()) {
    return sendMessageToTelegramWithContext(context)(ENV$1.I18N.command.help.img, 'tip');
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
async function commandGetHelp(message, command, subcommand, context) {
  let helpMsg = `${ENV$1.I18N.command.help.summary}\n`;
  helpMsg += Object.keys(commandHandlers)
    .map(key => `${key}：${ENV$1.I18N.command.help[key.substring(1)]}`)
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
    { type: 'blockquote', offset: 0, length: helpMsg.length },
  ];
  return sendMessageToTelegramWithContext(context)(helpMsg, 'tip');
}
async function commandCreateNewChatContext(message, command, subcommand, context) {
  try {
    await DATABASE.delete(context.SHARE_CONTEXT.chatHistoryKey);
    const isNewCommand = command.startsWith('/new');
    const text = ENV$1.I18N.command.new.new_chat_start + (isNewCommand ? '' : `(${context.CURRENT_CHAT_CONTEXT.chat_id})`);
    if (ENV$1.SHOW_REPLY_BUTTON && !CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)) {
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
async function commandUpdateUserConfig(message, command, subcommand, context, processUpdate = false) {
  if (command === '/mode') {
    if (subcommand === 'all') {
      const msg = `<pre>mode清单:   \n- ${Object.keys(context.USER_CONFIG.MODES).join('\n- ')}</pre>`;
      context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
      return sendMessageToTelegramWithContext(context)(msg, 'tip');
    } else if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(ENV$1.I18N.command.help.mode, 'tip');
    }
    if (!context.USER_CONFIG.MODES?.[subcommand]) {
      const msg = `mode \`${subcommand}\` not exist`;
      return sendMessageToTelegramWithContext(context)(msg, 'tip');
    }
    subcommand = `CURRENT_MODE=${subcommand}`;
  }
  const kv = subcommand.indexOf('=');
  if (kv === -1) {
    return sendMessageToTelegramWithContext(context)(ENV$1.I18N.command.help.setenv, 'tip');
  }
  let key = subcommand.slice(0, kv);
  const value = subcommand.slice(kv + 1);
  key = ENV_KEY_MAPPER[key] || key;
  if (ENV$1.LOCK_USER_CONFIG_KEYS.includes(key)) {
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
async function commandUpdateUserConfigs(message, command, subcommand, context, processUpdate = false) {
  try {
    if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(ENV$1.I18N.command.help.setenvs, 'tip');
    }
    const values = JSON.parse(subcommand);
    const configKeys = Object.keys(context.USER_CONFIG);
    for (const ent of Object.entries(values)) {
      let [key, value] = ent;
      key = ENV_KEY_MAPPER[key] || key;
      if (ENV$1.LOCK_USER_CONFIG_KEYS.includes(key)) {
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
async function commandSetUserConfigs(message, command, subcommand, context) {
  try {
    if (!subcommand) {
      return sendMessageToTelegramWithContext(context)(`\`\`\`plaintext\n${ENV$1.I18N.command.detail.set}\n\`\`\``, 'tip');
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
        if (ENV$1.LOCK_USER_CONFIG_KEYS.includes(key)) {
          return sendMessageToTelegramWithContext(context)(`Key ${key} is locked`, 'tip');
        }
        const role_perfix = '~';
        switch (key) {
          case 'SYSTEM_INIT_MESSAGE':
            if (v?.startsWith(role_perfix)) {
              value = ENV$1.PROMPT[v.substring(1)];
              if (!value) {
                msg += `>\`${v} is not exist, will use default prompt\`\n`;
                value = ENV$1.I18N?.env?.system_init_message || 'You are a helpful assistant';
              }
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
              value = Object.keys(ENV$1.TOOLS);
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
async function commandDeleteUserConfig(message, command, subcommand, context) {
  if (!subcommand) {
    return sendMessageToTelegramWithContext(context)(ENV$1.I18N.command.help.delenv, 'tip');
  }
  if (ENV$1.LOCK_USER_CONFIG_KEYS.includes(subcommand)) {
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
async function commandFetchUpdate(message, command, subcommand, context) {
  const current = {
    ts: ENV$1.BUILD_TIMESTAMP,
    sha: ENV$1.BUILD_VERSION,
  };
  try {
    const info = `https://raw.githubusercontent.com/adolphnov/ChatGPT-Telegram-Workers/${ENV$1.UPDATE_BRANCH}/dist/buildinfo.json`;
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
  if (ENV$1.DEV_MODE) {
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
async function commandEcho(message, command, subcommand, context) {
  let msg = '<pre>';
  msg += JSON.stringify({ message }, null, 2);
  msg += '</pre>';
  context.CURRENT_CHAT_CONTEXT.parse_mode = 'HTML';
  return sendMessageToTelegramWithContext(context)(msg, 'tip');
}
async function handleSystemCommand(message, command, raw, handler, context) {
  try {
    const commandLine = /^.*(\n|$)/.exec(message.text)[0];
    message.text = message.text.substring(commandLine.length);
    if (handler.needAuth) {
      const roleList = handler.needAuth(context.SHARE_CONTEXT.chatType);
      if (roleList) {
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
async function handlePluginCommand(message, command, raw, template, context) {
  try {
    const subcommand = raw.substring(command.length).trim();
    const DATA = formatInput(subcommand, template.input?.type);
    const { type, content } = await executeRequest(template, {
      DATA,
      ENV: ENV$1.PLUGINS_ENV,
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
function injectCommandHandlerIfNeed() {
  if (ENV$1.DEV_MODE) {
    commandHandlers['/echo'] = {
      help: '[DEBUG ONLY] echo message',
      scopes: ['all_private_chats', 'all_chat_administrators'],
      fn: commandEcho,
      needAuth: commandAuthCheck.default,
    };
  }
}
async function handleCommandMessage(message, context) {
  injectCommandHandlerIfNeed();
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
async function bindCommandForTelegram(token) {
  const scopeCommandMap = {
    all_private_chats: [],
    all_group_chats: [],
    all_chat_administrators: [],
  };
  for (const key of commandSortList) {
    if (ENV$1.HIDE_COMMAND_BUTTONS.includes(key)) {
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
        description: ENV$1.I18N.command.help[command.substring(1)] || '',
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
function commandsDocument() {
  return Object.keys(commandHandlers).map((key) => {
    return {
      command: key,
      description: ENV$1.I18N.command.help[key.substring(1)],
    };
  });
}

async function msgInitChatContext(message, context) {
    await context.initContext(message);
    return null;
}
async function msgSaveLastMessage(message, context) {
    if (ENV$1.DEBUG_MODE) {
        const lastMessageKey = `last_message:${context.SHARE_CONTEXT.chatHistoryKey}`;
        await DATABASE.put(lastMessageKey, JSON.stringify(message), { expirationTtl: 3600 });
    }
    return null;
}
async function msgIgnoreOldMessage(message, context) {
    if (ENV$1.SAFE_MODE) {
        let idList = [];
        try {
          idList = JSON.parse((await DATABASE.get(context.SHARE_CONTEXT.chatLastMessageIdKey)) || '[]');
        } catch (e) {
            console.error(e);
        }
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
async function msgCheckEnvIsReady(message, context) {
    if (!DATABASE) {
        return sendMessageToTelegramWithContext(context)('DATABASE Not Set', 'tip');
    }
    return null;
}
async function msgFilterWhiteList(message, context) {
    if (ENV$1.I_AM_A_GENEROUS_PERSON) {
        return null;
    }
    if (context.SHARE_CONTEXT.chatType === 'private') {
        if (!ENV$1.CHAT_WHITE_LIST.includes(`${context.CURRENT_CHAT_CONTEXT.chat_id}`)) {
            return sendMessageToTelegramWithContext(context)(
                `You are not in the white list, please contact the administrator to add you to the white list. Your chat_id: ${context.CURRENT_CHAT_CONTEXT.chat_id}`,
            );
        }
        return null;
    }
    if (CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)) {
        if (!ENV$1.GROUP_CHAT_BOT_ENABLE) {
            throw new Error('Not support');
        }
        if (!ENV$1.CHAT_GROUP_WHITE_LIST.includes(`${context.CURRENT_CHAT_CONTEXT.chat_id}`)) {
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
async function msgFilterUnsupportedMessage(message, context) {
  if (message.text || (ENV$1.EXTRA_MESSAGE_CONTEXT && message.reply_to_message?.text)) {
    return null;
  }
  if (ENV$1.ENABLE_FILE && (message.voice || message.audio || message.photo || message.image || message.document)) {
    return null;
  }
  throw new Error("Unsupported message");
}
async function msgHandlePrivateMessage(message, context) {
  if ('private' !== context.SHARE_CONTEXT.chatType) {
    return null;
  }
  if (!message.text && !message.caption) {
    return null;
  }
  if (!message.text && !ENV$1.ENABLE_FILE) {
    return new Response('Non text message', { 'status': 200 });
  }
  const chatMsgKey = Object.keys(ENV$1.CHAT_MESSAGE_TRIGGER).find((key) =>
    (message?.text || message?.caption || '').startsWith(key),
  );
  if (chatMsgKey) {
    if (message.text) {
      message.text = message.text.replace(chatMsgKey, ENV$1.CHAT_MESSAGE_TRIGGER[chatMsgKey]);
    } else message.caption = message.caption.replace(chatMsgKey, ENV$1.CHAT_MESSAGE_TRIGGER[chatMsgKey]);
  }
  return null;
}
async function msgHandleGroupMessage(message, context) {
  if (!CONST.GROUP_TYPES.includes(context.SHARE_CONTEXT.chatType)) {
    return null;
  }
  let botName = context.SHARE_CONTEXT.currentBotName;
  if (!botName) {
    botName = await getBotName(context.SHARE_CONTEXT.currentBotToken);
    context.SHARE_CONTEXT.currentBotName = botName;
  }
  if (!botName) {
    throw new Error('Not set bot name');
  }
  const chatMsgKey = Object.keys(ENV$1.CHAT_MESSAGE_TRIGGER).find((key) =>
    (message?.text || message?.caption || '').startsWith(key),
  );
  if (chatMsgKey) {
    let modifyType = '';
    if (message.text) {
      modifyType = 'text';
    } else modifyType = 'caption';
    message[modifyType] = message[modifyType].replace(chatMsgKey, ENV$1.CHAT_MESSAGE_TRIGGER[chatMsgKey]);
  }
  if (message.reply_to_message) {
    if (`${message.reply_to_message.from.id}` === context.SHARE_CONTEXT.currentBotId) {
      if (message.text.endsWith(`@${botName}`)) {
        message.text = message.text.substring(0, message.text.length - `@${botName}`.length);
      }
      return null;
    } else if (ENV$1.EXTRA_MESSAGE_CONTEXT) {
      context.SHARE_CONTEXT.extraMessageContext = message.reply_to_message;
    }
  }
  let isMention = false;
  if (message.text && message.entities) {
    const res = checkMention(message.text, message.entities, botName, context.SHARE_CONTEXT.currentBotId);
    isMention = res.isMention;
    message.text = res.content.trim();
  }
  if (message.caption && message.caption_entities) {
    const res = checkMention(message.caption, message.caption_entities, botName, context.SHARE_CONTEXT.currentBotId);
    isMention = res.isMention || isMention;
    message.caption = res.content.trim();
  }
  if (!isMention && chatMsgKey) {
    isMention = true;
  }
  if (!isMention) {
    throw new Error('Not mention');
  }
  return null;
}
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
async function msgIgnoreSpecificMessage(message) {
    if (
      ENV$1.IGNORE_TEXT && message?.text?.startsWith(ENV$1.IGNORE_TEXT)
    ) {
      return new Response('ignore specific text', { status: 200 });
    }
    return null;
}
async function msgInitMiddleInfo(message, context) {
  try {
    await MiddleInfo.initInfo(message, context);
    return null;
  } catch (e) {
    console.log(e.message);
    throw new Error('Can’t init info, please see the log for detail.');
  }
}
async function msgHandleCommand(message, context) {
    if (!message.text) {
        return null;
    }
    return await handleCommandMessage(message, context);
}
async function msgChatWithLLM(message, context) {
  const is_concurrent = context._info.is_concurrent;
  if (context._info.file.type !== 'text') {
    context._info.file.url = await getTelegramFileUrl(context._info.file, context.SHARE_CONTEXT.currentBotToken);
  }
  const llmPromises = [];
  try {
    let result = null;
    for (let i = 0; i < context._info.chains.length; i++) {
      if (context.CURRENT_CHAT_CONTEXT.message_id && !ENV$1.HIDE_MIDDLE_MESSAGE) {
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
async function sendInitMessage(context) {
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
function sendTelegramMessage(context, file) {
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
async function scheduledDeleteMessage(message, context) {
  const { sentMessageIds } = context.SHARE_CONTEXT;
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
  const offsetInMillisenconds = ENV$1.EXPIRED_TIME * 60 * 1000;
  scheduledData[botName][chatId].push({
    id: [...sentMessageIds],
    ttl: Date.now() + offsetInMillisenconds,
  });
  await DATABASE.put(scheduleDeteleKey, JSON.stringify(scheduledData));
  console.log(`Record chat ${chatId}, message ids: ${[...sentMessageIds]}`);
  return new Response('success', { status: 200 });
}
async function msgTagNeedDelete(message, context) {
  return await scheduledDeleteMessage(message, context);
}
async function msgStoreWhiteListMessage(message, context) {
  if (ENV$1.STORE_MESSAGE_WHITELIST.includes(message.message.from.id) && ENV$1.STORE_MESSAGE_NUM > 0) {
    const storeMessageKey = context.SHARE_CONTEXT.storeMessageKey;
    const data = JSON.parse(await DATABASE.get(storeMessageKey) || '[]');
    data.push(await extractMessageType(message));
    if (data.length > ENV$1.STORE_MESSAGE_NUM) {
      data.splice(0, data.length - ENV$1.STORE_MESSAGE_NUM);
    }
    await DATABASE.put(storeMessageKey, JSON.stringify(data));
  }
  return new Response('ok');
}
async function handleMessage(token, body) {
  const context = new Context();
  context.initTelegramContext(token);
  const message = loadMessage(body);
    const handlers = [
      msgInitChatContext,
      msgIgnoreSpecificMessage,
      msgCheckEnvIsReady,
      msgFilterWhiteList,
      msgIgnoreOldMessage,
      msgSaveLastMessage,
      msgFilterUnsupportedMessage,
      msgHandlePrivateMessage,
      msgHandleGroupMessage,
      msgInitUserConfig,
      msgInitMiddleInfo,
      msgHandleCommand,
      msgChatWithLLM,
    ];
    const exitHanders = [msgTagNeedDelete,msgStoreWhiteListMessage];
  for (const handler of handlers) {
        try {
          const result = await handler(message, context);
          if (result && result instanceof Response) {
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

class Router {
    constructor({ base = '', routes = [], ...other } = {}) {
        this.routes = routes;
        this.base = base;
        Object.assign(this, other);
    }
    parseQueryParams(searchParams) {
        const query = Object.create(null);
        for (const [k, v] of searchParams) {
            query[k] = k in query ? [].concat(query[k], v) : v;
        }
        return query;
    }
    normalizePath(path) {
        return path.replace(/\/+(\/|$)/g, '$1');
    }
    createRouteRegex(path) {
        return RegExp(`^${path
            .replace(/(\/?\.?):(\w+)\+/g, '($1(?<$2>*))')
            .replace(/(\/?\.?):(\w+)/g, '($1(?<$2>[^$1/]+?))')
            .replace(/\./g, '\\.')
            .replace(/(\/?)\*/g, '($1.*)?')
        }/*$`);
    }
    async fetch(request, ...args) {
        const url = new URL(request.url);
        const reqMethod = request.method.toUpperCase();
        request.query = this.parseQueryParams(url.searchParams);
        for (const [method, regex, handlers, path] of this.routes) {
            let match = null;
            if ((method === reqMethod || method === 'ALL') && (match = url.pathname.match(regex))) {
                request.params = match?.groups || {};
                request.route = path;
                for (const handler of handlers) {
                    const response = await handler(request.proxy ?? request, ...args);
                    if (response != null)
                        return response;
                }
            }
        }
    }
    route(method, path, ...handlers) {
        const route = this.normalizePath(this.base + path);
        const regex = this.createRouteRegex(route);
        this.routes.push([method.toUpperCase(), regex, handlers, route]);
        return this;
    }
    get(path, ...handlers) {
        return this.route('GET', path, ...handlers);
    }
    post(path, ...handlers) {
        return this.route('POST', path, ...handlers);
    }
    put(path, ...handlers) {
        return this.route('PUT', path, ...handlers);
    }
    delete(path, ...handlers) {
        return this.route('DELETE', path, ...handlers);
    }
    patch(path, ...handlers) {
        return this.route('PATCH', path, ...handlers);
    }
    head(path, ...handlers) {
        return this.route('HEAD', path, ...handlers);
    }
    options(path, ...handlers) {
        return this.route('OPTIONS', path, ...handlers);
    }
    all(path, ...handlers) {
        return this.route('ALL', path, ...handlers);
    }
}

const helpLink = 'https://github.com/TBXark/ChatGPT-Telegram-Workers/blob/master/doc/en/DEPLOY.md';
const issueLink = 'https://github.com/TBXark/ChatGPT-Telegram-Workers/issues';
const initLink = './init';
const footer = `
<br/>
<p>For more information, please visit <a href="${helpLink}">${helpLink}</a></p>
<p>If you have any questions, please visit <a href="${issueLink}">${issueLink}</a></p>
`;
function buildKeyNotFoundHTML(key) {
    return `<p style="color: red">Please set the <strong>${key}</strong> environment variable in Cloudflare Workers.</p> `;
}
async function bindWebHookAction(request) {
    const result = [];
    const domain = new URL(request.url).host;
    const hookMode = API_GUARD ? 'safehook' : 'webhook';
    for (const token of ENV$1.TELEGRAM_AVAILABLE_TOKENS) {
        const url = `https://${domain}/telegram/${token.trim()}/${hookMode}`;
        console.log(url);
        const id = token.split(':')[0];
        result[id] = {
            webhook: await bindTelegramWebHook(token, url).catch((e) => errorToString(e)),
            command: await bindCommandForTelegram(token).catch((e) => errorToString(e)),
        };
    }
    const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <h2>${domain}</h2>
    ${
        ENV$1.TELEGRAM_AVAILABLE_TOKENS.length === 0 ? buildKeyNotFoundHTML('TELEGRAM_AVAILABLE_TOKENS') : ''
    }
    ${
        Object.keys(result).map((id) => `
        <br/>
        <h4>Bot ID: ${id}</h4>
        <p style="color: ${result[id].webhook.ok ? 'green' : 'red'}">Webhook: ${JSON.stringify(result[id].webhook)}</p>
        <p style="color: ${result[id].command.ok ? 'green' : 'red'}">Command: ${JSON.stringify(result[id].command)}</p>
        `).join('')
    }
      ${footer}
    `);
    return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}
async function telegramWebhook(request) {
    try {
        const { token } = request.params;
        const body = await request.json();
        return makeResponse200(await handleMessage(token, body));
    } catch (e) {
        console.error(e);
        return new Response(errorToString(e), {status: 200});
    }
}
async function telegramSafeHook(request) {
    try {
        if (API_GUARD === undefined || API_GUARD === null) {
            return telegramWebhook(request);
        }
        console.log('API_GUARD is enabled');
        const url = new URL(request.url);
        url.pathname = url.pathname.replace('/safehook', '/webhook');
        request = new Request(url, request);
        return makeResponse200(await API_GUARD.fetch(request));
    } catch (e) {
        console.error(e);
        return new Response(errorToString(e), {status: 200});
    }
}
async function defaultIndexAction() {
    const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <p>Deployed Successfully!</p>
    <p> Version (ts:${ENV$1.BUILD_TIMESTAMP},sha:${ENV$1.BUILD_VERSION})</p>
    <br/>
    <p>You must <strong><a href="${initLink}"> >>>>> click here <<<<< </a></strong> to bind the webhook.</p>
    <br/>
    <p>After binding the webhook, you can use the following commands to control the bot:</p>
    ${
        commandsDocument().map((item) => `<p><strong>${item.command}</strong> - ${item.description}</p>`).join('')
    }
    <br/>
    <p>You can get bot information by visiting the following URL:</p>
    <p><strong>/telegram/:token/bot</strong> - Get bot information</p>
    ${footer}
  `);
    return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}
async function loadBotInfo() {
    const result = [];
    for (const token of ENV$1.TELEGRAM_AVAILABLE_TOKENS) {
        const id = token.split(':')[0];
        result[id] = await getBotName(token);
    }
    const HTML = renderHTML(`
    <h1>ChatGPT-Telegram-Workers</h1>
    <br/>
    <h4>Environment About Bot</h4>
    <p><strong>GROUP_CHAT_BOT_ENABLE:</strong> ${ENV$1.GROUP_CHAT_BOT_ENABLE}</p>
    <p><strong>GROUP_CHAT_BOT_SHARE_MODE:</strong> ${ENV$1.GROUP_CHAT_BOT_SHARE_MODE}</p>
    <p><strong>TELEGRAM_BOT_NAME:</strong> ${ENV$1.TELEGRAM_BOT_NAME.join(',')}</p>
    ${
        Object.keys(result).map((id) => `
            <br/>
            <h4>Bot ID: ${id}</h4>
            <p style="color: ${result[id].ok ? 'green' : 'red'}">${JSON.stringify(result[id])}</p>
            `).join('')
    }
    ${footer}
  `);
    return new Response(HTML, {status: 200, headers: {'Content-Type': 'text/html'}});
}
async function handleRequest(request) {
    const router = new Router();
    router.get('/', defaultIndexAction);
    router.get('/init', bindWebHookAction);
    router.post('/telegram/:token/webhook', telegramWebhook);
    router.post('/telegram/:token/safehook', telegramSafeHook);
    if (ENV$1.DEV_MODE || ENV$1.DEBUG_MODE) {
        router.get('/telegram/:token/bot', loadBotInfo);
    }
    router.all('*', () => new Response('Not Found', {status: 404}));
    return router.fetch(request);
}

const zhHans = {"env":{"system_init_message":"你是一个得力的助手"},"command":{"help":{"summary":"当前支持以下命令:\n","help":"获取命令帮助","new":"发起新的对话","start":"获取你的ID, 并发起新的对话","img":"生成一张图片, 命令完整格式为 `/img 图片描述`, 例如`/img 月光下的沙滩`","version":"获取当前版本号, 判断是否需要更新","setenv":"设置用户配置，命令完整格式为 /setenv KEY=VALUE","setenvs":"批量设置用户配置, 命令完整格式为 /setenvs {\"KEY1\": \"VALUE1\", \"KEY2\": \"VALUE2\"}","set":"/set 命令格式为 /set 选项 值 [选项 值…] [-u][\\n]","delenv":"删除用户配置，命令完整格式为 /delenv KEY","clearenv":"清除所有用户配置, send /clearenv true","system":"查看当前一些系统信息","redo":"重做上一次的对话, /redo 加修改过的内容 或者 直接 /redo","echo":"回显消息", "mode":"命令完整格式为 /mode NAME, 当NAME=all时, 查看所有mode"},"new":{"new_chat_start":"新的对话已经开始"},"detail":{"set":"/set 命令格式为 /set 选项 值 [选项 值…] [-u][\\n]\n  选项预置如下： \n  -p 调整 SYSTEM_INIT_MESSAGE\n  -m 调整 CHAT_MODEL\n  -n 调整 MAX_HISTORY_LENGTH\n  -a 调整 AI_PROVIDER\n  -ai 调整 AI_IMAGE_PROVIDER\n  -v 调整 OPENAI_VISION_MODEL\n  -t 调整 OPENAI_TTS_MODEL\n  \n  可自行设置 MAPPING_KEY, 使用半角|进行分割,:左边为选项，右边为对应变量\n  可设置值 MAPPING_KEY 对某些常用值进行简写，同样半角|进行分割,:左边为选项，右边为对应变量\n  例如：MAPPING_VALUE = 'c35son:claude-3-5-sonnet-20240620|r+:command-r-plus'\n  在使用/set时快速调整参数: /set -m r+ -v gpt-4o\n\n  /set命令默认不会将修改的参数存储，仅临时调整，单次对话有效；需要存储修改时，追加参数-u\n  /set命令追加文本处理时，需要键入换行来进行分割，另起一行输入对话，不换行时类似/setenv 无法继续与模型对话\n  选项与参数值均为空格分割，故两者本身不能有空格，否则可能会解析出错\n  调整SYSTEM_INIT_MESSAGE时，若设置了PROMPT可直接使用设置为角色名，自动填充角色prompt，例如：\n  /set -p ~doctor -n 0\n  可使用 TRIGGER进行再次简化:\n  \"~\":\"/set -p ~\" 这样对话时直接键入 ~doctor\n今天整个人昏沉沉的，我需要如何调理身体？"}}};

const zhHant = {"env":{"system_init_message":"你是一個得力的助手"},"command":{"help":{"summary":"當前支持的命令如下：\n","help":"獲取命令幫助","new":"開始一個新對話","start":"獲取您的ID並開始一個新對話","img":"生成圖片，完整命令格式為`/img 圖片描述`，例如`/img 海灘月光`","version":"獲取當前版本號確認是否需要更新","setenv":"設置用戶配置，完整命令格式為/setenv KEY=VALUE","setenvs":"批量設置用户配置, 命令完整格式為 /setenvs {\"KEY1\": \"VALUE1\", \"KEY2\": \"VALUE2\"}","set":"/set 命令格式為 /set 選項 值 [選項 值…] [-u][\\n]","delenv":"刪除用戶配置，完整命令格式為/delenv KEY","clearenv":"清除所有用戶配置, 发送/clearenv true","system":"查看一些系統信息","redo":"重做上一次的對話 /redo 加修改過的內容 或者 直接 /redo","echo":"回显消息","mode":"命令格式為 /mode NAME, 当NAME=all时, 查看所有mode"},"new":{"new_chat_start":"開始一個新對話"},"detail":{"set":"/set 命令格式为 /set 选项 值 [选项 值…] [-u][\\n]\n  选项预置如下： \n  -p 调整 SYSTEM_INIT_MESSAGE\n  -o 调整 CHAT_MODEL\n  -n 调整 MAX_HISTORY_LENGTH\n  -a 调整 AI_PROVIDER\n  -ai 调整 AI_IMAGE_PROVIDER\n  -v 调整 OPENAI_VISION_MODEL\n  -t 调整 OPENAI_TTS_MODEL\n  \n  可自行设置 MAPPING_KEY, 使用半角|进行分割,:左边为选项，右边为对应变量\n  可设置值 MAPPING_KEY 对某些常用值进行简写，同样半角|进行分割,:左边为选项，右边为对应变量\n  例如：MAPPING_VALUE = 'c35son:claude-3-5-sonnet-20240620|r+:command-r-plus'\n  在使用/set时快速调整参数: /set -m r+ -v gpt-4o\n\n  /set命令默认不会将修改的参数存储，仅临时调整，单次对话有效；需要存储修改时，追加参数-u\n  /set命令追加文本处理时，需要键入换行来进行分割，另起一行输入对话，不换行时类似/setenv 无法继续与模型对话\n  选项与参数值均为空格分割，故两者本身不能有空格，否则可能会解析出错\n  调整SYSTEM_INIT_MESSAGE时，若设置了PROMPT可直接使用设置为角色名，自动填充角色prompt，例如：\n  /set -p ~doctor -n 0\n  可使用 TRIGGER进行再次简化:\n  \"~\":\"/set -p ~\" 这样对话时直接键入 ~doctor\n今天整个人昏沉沉的，我需要如何调理身体？"}}};

const pt = {"env":{"system_init_message":"Você é um assistente útil"},"command":{"help":{"summary":"Os seguintes comandos são suportados atualmente:\n","help":"Obter ajuda sobre comandos","new":"Iniciar uma nova conversa","start":"Obter seu ID e iniciar uma nova conversa","img":"Gerar uma imagem, o formato completo do comando é `/img descrição da imagem`, por exemplo `/img praia ao luar`","version":"Obter o número da versão atual para determinar se é necessário atualizar","setenv":"Definir configuração do usuário, o formato completo do comando é /setenv CHAVE=VALOR","setenvs":"Definir configurações do usuário em lote, o formato completo do comando é /setenvs {\"CHAVE1\": \"VALOR1\", \"CHAVE2\": \"VALOR2\"}","delenv":"Excluir configuração do usuário, o formato completo do comando é /delenv CHAVE","clearenv":"Limpar todas as configurações do usuário","system":"Ver algumas informações do sistema","redo":"Refazer a última conversa, /redo com conteúdo modificado ou diretamente /redo","echo":"Repetir a mensagem"},"new":{"new_chat_start":"Uma nova conversa foi iniciada"}}};

const en = {"env":{"system_init_message":"You are a helpful assistant"},"command":{"help":{"summary":"The following commands are currently supported:\n","help":"Get command help","new":"Start a new conversation","start":"Get your ID and start a new conversation","img":"Generate an image, the complete command format is `/img image description`, for example `/img beach at moonlight`","version":"Get the current version number to determine whether to update","setenv":"Set user configuration, the complete command format is /setenv KEY=VALUE","setenvs":"Batch set user configurations, the full format of the command is /setenvs {\"KEY1\": \"VALUE1\", \"KEY2\": \"VALUE2\"}","set": "/set command format is /set option value [option value...] [-u][\\n]","delenv":"Delete user configuration, the complete command format is /delenv KEY","clearenv":"Clear all user configuration, send /clearenv true","system":"View some system information","redo":"Redo the last conversation, /redo with modified content or directly /redo","echo":"Echo the message","mode":"the full format of the command is /mode NAME, when NAME=all, view all modes"},"new":{"new_chat_start":"A new conversation has started"}, "detail":{"set":"/set The command format is /set Option Value [Option Value...] [-u][\\n]\n The option presets are as follows: \n -p Adjust SYSTEM_INIT_MESSAGE\n -m Adjust CHAT_MODEL\n -n Adjust MAX_ HISTORY_LENGTH\n -a Adjust AI_PROVIDER\n -ai Adjust AI_IMAGE_PROVIDER\n -v Adjust OPENAI_VISION_MODEL\n -t Adjust OPENAI_TTS_MODEL\n \n You can set up the MAPPING_KEY by yourself, and use the half-corner for the MAPPING_KEY, split by half-corners,: options on the left, corresponding variables on the right \n Can set the value MAPPING_KEY abbreviate some commonly used values, also split by half-corners,: options on the left, corresponding variables on the right \n For example: MAPPING_VALUE = 'c35son:claude-3-5-sonnet-20240620|r+: command-r-plus' \n+. command-r-plus'\n Quickly adjust parameters when using /set: /set -m r+ -v gpt-4o\n\n /set command will not store modified parameters by default, only temporary adjustments, valid for a single conversation; when you need to store the changes, append the parameter -u\n /set command to append the text processing, you need to type a newline to split, start a new line and type the conversation without a newline. When you type in a newline to split the dialog, you can't continue the dialog with the model without a newline, similar to /setenv \n Options and parameter values are split by spaces, so there can't be any spaces between the two, or else there may be parsing errors \n Adjustment of the SYSTEM_INIT_MESSAGE, if you have set up a PROMPT you can use the set to the role name directly to automatically fill in the role Prompt, for example: \n / set -p ~doctor -n 0\n Can use TRIGGER to simplify again:\n \"~\":\"/set -p ~\" so that when dialoguing, you can directly type ~doctor\n Today, the whole person is lethargic, how do I need to regulate my body?"}}};

function i18n(lang) {
    switch (lang.toLowerCase()) {
        case 'cn':
        case 'zh-cn':
        case 'zh-hans':
            return zhHans;
        case 'zh-tw':
        case 'zh-hk':
        case 'zh-mo':
        case 'zh-hant':
            return zhHant;
        case 'pt':
        case 'pt-br':
            return pt;
        case 'en':
        case 'en-us':
            return en;
        default:
            return en;
    }
}

class RedisCache {
  constructor (baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }
  async fetchFromRedis(endpoint, method = 'GET', body = null) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
    const options = {
      method,
      headers,
      ...(body && { body: body }),
    };
    const response = await fetch(`${this.baseUrl}/${endpoint}`, options);
    if (!response.ok) {
      throw new Error(`Failed to fetch from Redis: ${response.error}`)
    }
    return response.json()
  }
  async get(key, info) {
    try {
      const raw = await this.fetchFromRedis(`get/${key}`);
      if (!raw) {
        return null
      }
      switch (info?.type || 'string') {
        case 'string':
          return raw.result
        case 'json':
          return JSON.parse(raw.result)
        case 'arrayBuffer':
          return new Uint8Array(raw).buffer
        default:
          return raw.result
      }
    } catch (error) {
      console.error(`Error getting key ${key}:`, error);
      return null
    }
  }
  async put(key, value, info) {
    let endpoint = `set/${key}`;
    let expiration = -1;
    if (info && info.expiration) {
      expiration = Math.round(info.expirationTtl);
    } else if (info && info.expirationTtl) {
      expiration = Math.round(Date.now() / 1000 + info.expirationTtl);
    }
    if (expiration > 0) {
      endpoint += `?exat=${expiration}`;
    }
    await this.fetchFromRedis(endpoint, 'POST', value);
  }
  async delete(key) {
    await this.fetchFromRedis(`del/${key}`, 'POST');
  }
}


const main = {
  async fetch(request, env, ctx) {
    try {
      if (!env.DATABASE && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        env.DATABASE = new RedisCache(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
      }
      initEnv(env, i18n);
      return await handleRequest(request);
    } catch (e) {
      console.error(e);
      return new Response(errorToString(e), { status: 500 });
    }
  },
  async scheduled(event, env, ctx) {
    try {
      if (!env.DATABASE && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        env.DATABASE = new RedisCache(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
      }
      const promises = [];
      for (const task of Object.values(tasks)) {
        promises.push(task(env));
      }
      await Promise.all(promises);
      console.log('All tasks done.');
    } catch (e) {
      console.error('Error in scheduled tasks:', e);
    }
  },
};

export { main as default };
