import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.remoteHost = `${self.location.origin}/hf/`;
env.remotePathTemplate = '{model}/resolve/{revision}/{file}';

let transcriber = null;
let translator = null;
let transcriberModel = null;

const WHISPER_MODELS = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
};

function progress(kind) {
  return (data) => {
    const pct = data?.progress == null ? null : Math.round(data.progress);
    self.postMessage({ type: 'progress', kind, status: data?.status || '', file: data?.file || '', progress: pct });
  };
}

async function getTranscriber(modelKey, device) {
  const model = WHISPER_MODELS[modelKey] || WHISPER_MODELS.base;
  if (!transcriber || transcriberModel !== `${model}:${device}`) {
    transcriber = await pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'webgpu' ? 'q8' : 'q8',
      progress_callback: progress('whisper')
    });
    transcriberModel = `${model}:${device}`;
  }
  return transcriber;
}

async function getTranslator(device) {
  if (!translator) {
    translator = await pipeline('translation', 'Xenova/m2m100_418M', {
      device,
      dtype: device === 'webgpu' ? 'q8' : 'q8',
      progress_callback: progress('translate')
    });
  }
  return translator;
}

function cleanChunks(chunks = []) {
  return chunks.map((c, i) => ({
    id: i + 1,
    start: Array.isArray(c.timestamp) ? (c.timestamp[0] ?? 0) : 0,
    end: Array.isArray(c.timestamp) ? (c.timestamp[1] ?? 0) : 0,
    text: (c.text || '').trim(),
  })).filter(x => x.text);
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data || {};
  try {
    if (action === 'transcribe') {
      const device = payload.device || 'wasm';
      const pipe = await getTranscriber(payload.model || 'base', device);
      const opts = {
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      };
      if (payload.language && payload.language !== 'auto') opts.language = payload.language;
      const result = await pipe(payload.audio, opts);
      self.postMessage({ id, type: 'result', action, result: { text: (result.text || '').trim(), chunks: cleanChunks(result.chunks || []) } });
      return;
    }
    if (action === 'translate') {
      const pipe = await getTranslator(payload.device || 'wasm');
      const texts = payload.texts || [];
      const results = [];
      for (let i = 0; i < texts.length; i++) {
        const input = texts[i];
        if (!input?.trim()) { results.push(''); continue; }
        const out = await pipe(input, { src_lang: payload.src, tgt_lang: payload.dst, max_new_tokens: 512 });
        results.push(out?.[0]?.translation_text || '');
        self.postMessage({ type: 'stage', kind: 'translate', current: i + 1, total: texts.length });
      }
      self.postMessage({ id, type: 'result', action, result: results });
      return;
    }
    throw new Error('未知任务');
  } catch (error) {
    self.postMessage({ id, type: 'error', action, error: `${error?.name ? error.name + ': ' : ''}${error?.message || String(error)}` });
  }
};
