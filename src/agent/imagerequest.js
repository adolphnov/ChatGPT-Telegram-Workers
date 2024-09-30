import { sendMediaGroupToTelegramWithContext, sendMessageToTelegramWithContext,sendPhotoToTelegramWithContext, sendChatActionToTelegramWithContext } from "../telegram/telegram.js";
import { openaiLikeAgent } from "./openai.js";
import { loadImageGen } from "./agents.js";

export async function requestI2IHander(context, params) {
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
  };
}

export async function requestText2Image(context, params) {

  const gen = loadImageGen(context)?.request;
  if (!gen) {
    return sendMessageToTelegramWithContext(context)(`ERROR: Image generator not found`, 'tip');
  }
  // setTimeout(() => sendChatActionToTelegramWithContext(context)('upload_photo').catch(console.error), 0);
  setTimeout(() => {
    sendMessageToTelegramWithContext(context)('It may take a while, please wait.', 'tip').catch(console.error);
  }, 0);
  console.log('start generate image.')
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
}


/**
 * @description: 
 * @param {ContextType} context
 * @param {Promise<Response>} response
 * @return {*}
 */
export async function renderText2PicResult(context, response) {
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

export function renderPic2PicResult(context, resp) {
  switch (context.USER_CONFIG.AI_IMAGE_PROVIDER) {
    case 'silicon':
      return { type: 'image', url: resp?.images?.map(i => i?.url), message: resp.message };
  }
}