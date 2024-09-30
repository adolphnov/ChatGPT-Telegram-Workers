/**
 * @param {string} body
 * @returns {string}
 */
export function renderHTML(body) {
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

/**
 * @param {Error} e
 * @returns {string}
 */
export function errorToString(e) {
    return JSON.stringify({
        message: e.message,
        stack: e.stack,
    });
}

/**
 * @param {Response} resp
 * @returnss {Response}
 */
export function makeResponse200(resp) {
  if (resp === null) {
    return new Response('NOT HANDLED', { status: 200 });
  }
  if (resp.status === 200) {
    return resp;
  } else {
    // 如果返回4xx，5xx，Telegram会重试这个消息，后续消息就不会到达，所有webhook的错误都返回200
    return new Response(resp.body, {
      status: 200,
      headers: {
        'Original-Status': resp.status,
        ...resp.headers,
      },
    });
  }
}

/**
 * 
 * @returns {Function} ：
 *  - url {String} 
 *  - options {Object} 
 *  - retries {Number} 
 *  - delayMs {Number} 
 */
function fetchWithRetryFunc() {
  const status429RetryTime = {};
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  const RETRY_MULTIPLIER = 2;
  const DEFAULT_RETRY_AFTER = 10;

  return async (url, options, retries = MAX_RETRIES, delayMs = RETRY_DELAY_MS) => {
    let errorMsg = '';
    while (retries > 0) {
      try {
        const parsedUrl = new URL(url);
        const domain = `${parsedUrl.protocol}//${parsedUrl.host}`;
        const now = Date.now();
        // console.log(`status429RetryTime[domain]: ${status429RetryTime[domain]}`);
        // console.log(`now: ${now}`);
        // console.log(`${((status429RetryTime[domain] ?? now) - now)/1000 }s`)

        if ((status429RetryTime[domain] ?? now) > now) {
          return new Response('{"ok":false}', {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': Math.ceil((status429RetryTime[domain] - now) / 1000),
            },
          });
        }
        if (status429RetryTime[domain]) {
          status429RetryTime[domain] = null;
        }
        let resp = await fetch(url, options);
        if (resp.ok) {
          if (retries < MAX_RETRIES) console.log(`[DONE] after ${MAX_RETRIES - retries} times`);
          return resp;
        }
        const clone_resp = await resp.clone().text();
        console.error(`Error fetch: ${clone_resp}`);
        if (resp.status === 429) {
          const retryAfter = resp.headers.get('Retry-After') || DEFAULT_RETRY_AFTER;
          status429RetryTime[domain] = Date.now() + 1000 * retryAfter;
          return resp;
        } else {
          throw new Error(`status: ${resp.statusText}`);
        }
      } catch (error) {
        errorMsg = error.message;
        console.error(`Request failed, retry after ${delayMs / 1000} s: ${error}`);
      }
      await delay(delayMs);
      delayMs *= RETRY_MULTIPLIER;
      retries--;
    }
    throw new Error(`Failed after maximum retries, please see the log.`);
  };
}

export const fetchWithRetry = fetchWithRetryFunc();

/**
 * 延迟执行一段时间
 * @param {number} ms 毫秒数
 * @returns {Promise<void>}
 */
export function delay(ms = 1000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * @description: 生成UUIDv4
 * @return {String}
 */
export function UUIDv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
  