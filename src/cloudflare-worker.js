const ASR_MODEL = '@cf/openai/whisper-large-v3-turbo';
const MT_MODEL = '@cf/meta/m2m100-1.2b';
const GATEWAY_ID = 'default';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const LANG_NAMES = {
  zh: 'chinese', en: 'english', fr: 'french', es: 'spanish', de: 'german', it: 'italian',
  pt: 'portuguese', ja: 'japanese', ko: 'korean', ru: 'russian', ar: 'arabic', nl: 'dutch',
  pl: 'polish', tr: 'turkish', uk: 'ukrainian', cs: 'czech', sv: 'swedish', fi: 'finnish',
  da: 'danish', el: 'greek', he: 'hebrew', hi: 'hindi', id: 'indonesian'
};

const gatewayOptions = () => ({
  gateway: {
    id: GATEWAY_ID,
    skipCache: true,
  },
});

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

function createProbeWavBase64() {
  const sampleRate = 16000;
  const durationSeconds = 0.25;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return toBase64(buffer);
}

function normalizeText(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  a = normalizeText(a).toLowerCase();
  b = normalizeText(b).toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.78) return shorter.length / longer.length;
  const wa = new Set(a.split(/\s+/));
  const wb = new Set(b.split(/\s+/));
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size, 1);
}

function cleanSegments(rawSegments = []) {
  const cleaned = [];
  const warnings = [];
  let repeatRun = 0;
  let last = '';
  for (let i = 0; i < rawSegments.length; i++) {
    const s = rawSegments[i] || {};
    const text = normalizeText(s.text || s.transcript || '');
    if (!text) continue;
    const sim = similarity(last, text);
    repeatRun = sim >= 0.92 ? repeatRun + 1 : 0;
    if (repeatRun >= 2) {
      warnings.push(`已拦截疑似重复幻觉片段：${text.slice(0, 80)}`);
      continue;
    }
    const start = Number(s.start ?? s.start_time ?? 0);
    const end = Number(s.end ?? s.end_time ?? start);
    cleaned.push({ id: cleaned.length + 1, start, end, text });
    last = text;
  }
  return { cleaned, warnings: [...new Set(warnings)] };
}

function splitForTranslation(text, max = 1200) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[.!?。！？])\s+/);
  const out = [];
  let cur = '';
  for (const sentence of sentences) {
    if (!sentence) continue;
    if ((cur + ' ' + sentence).trim().length <= max) {
      cur = (cur + ' ' + sentence).trim();
    } else {
      if (cur) out.push(cur);
      if (sentence.length <= max) cur = sentence;
      else {
        for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max));
        cur = '';
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

function extractTranslation(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  return normalizeText(result.translated_text || result.translation || result.text || result.result?.translated_text || '');
}

async function runAI(env, model, input) {
  return env.AI.run(model, input, gatewayOptions());
}

async function translateText(env, text, source, target) {
  if (!text || target === 'none' || source === target) return source === target ? text : '';
  if (source === 'auto') throw new Error('自动检测可用于转写；需要翻译时请明确选择原语言，以保证翻译方向正确。');
  const chunks = splitForTranslation(text);
  const results = [];
  for (const chunk of chunks) {
    const r = await runAI(env, MT_MODEL, {
      text: chunk,
      source_lang: LANG_NAMES[source] || source,
      target_lang: LANG_NAMES[target] || target,
    });
    const t = extractTranslation(r);
    if (!t) throw new Error('翻译模型未返回有效文本');
    results.push(t);
  }
  return results.join('\n\n');
}

async function deepHealth(env) {
  const started = Date.now();
  const checks = { gateway: GATEWAY_ID, translation: false, asr: false };
  try {
    const translated = await runAI(env, MT_MODEL, {
      text: 'Hello', source_lang: 'english', target_lang: 'french',
    });
    checks.translation = Boolean(extractTranslation(translated));

    await runAI(env, ASR_MODEL, {
      audio: createProbeWavBase64(),
      task: 'transcribe',
      vad_filter: true,
      condition_on_previous_text: false,
      no_speech_threshold: 0.6,
    });
    checks.asr = true;

    return {
      ok: checks.translation && checks.asr,
      ai_ready: checks.translation && checks.asr,
      version: '4.1.1',
      architecture: 'public-cloud',
      gateway: GATEWAY_ID,
      checks,
      latency_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      ai_ready: false,
      version: '4.1.1',
      architecture: 'public-cloud',
      gateway: GATEWAY_ID,
      checks,
      error: String(e?.message || e),
      latency_ms: Date.now() - started,
    };
  }
}

async function handleProcess(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  const source = String(form.get('source_lang') || 'auto');
  const target = String(form.get('target_lang') || 'none');
  const quality = String(form.get('quality') || 'high');

  if (!(file instanceof File)) return json({ ok: false, error: 'missing_file', detail: '请选择音频文件。' }, 400);
  if (file.size <= 0) return json({ ok: false, error: 'empty_file', detail: '文件为空。' }, 400);
  if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: 'file_too_large', detail: 'V4.1.1 Cloud 单文件上限 20 MB。长音频分块队列将在下一阶段加入。' }, 413);

  const audio = toBase64(await file.arrayBuffer());
  const payload = {
    audio,
    task: 'transcribe',
    vad_filter: true,
    beam_size: quality === 'high' ? 5 : 3,
    condition_on_previous_text: false,
    no_speech_threshold: 0.6,
    compression_ratio_threshold: 2.4,
    log_prob_threshold: -1,
    hallucination_silence_threshold: 1.0,
  };
  if (source !== 'auto') payload.language = source;

  let asr;
  try {
    asr = await runAI(env, ASR_MODEL, payload);
  } catch (e) {
    const message = String(e?.message || e);
    const gatewayHint = /2001|gateway/i.test(message)
      ? 'AI Gateway 未就绪。V4.1.1 已改用可自动创建的 default Gateway；请重新运行一键部署并确认最后的“AI 推理链路自检通过”。'
      : '';
    return json({
      ok: false,
      error: 'asr_failed',
      detail: `Cloudflare Whisper 处理失败：${message}${gatewayHint ? `\n${gatewayHint}` : ''}`,
    }, 502);
  }

  const rawText = normalizeText(asr?.text || asr?.transcription_info?.text || '');
  const rawSegments = Array.isArray(asr?.segments) ? asr.segments : [];
  const { cleaned, warnings } = cleanSegments(rawSegments);
  const transcript = cleaned.length ? cleaned.map(s => s.text).join(' ') : rawText;
  if (!transcript) return json({ ok: false, error: 'empty_transcript', detail: '没有识别到可靠语音内容。' }, 422);

  let translation = '';
  let translation_error = '';
  if (target !== 'none') {
    try {
      translation = await translateText(env, transcript, source, target);
    } catch (e) {
      translation_error = String(e?.message || e);
    }
  }

  return json({
    ok: true,
    version: '4.1.1',
    provider: 'cloudflare-workers-ai',
    gateway: GATEWAY_ID,
    asr_model: ASR_MODEL,
    translation_model: MT_MODEL,
    transcript,
    translation,
    translation_error,
    segments: cleaned,
    vtt: asr?.vtt || '',
    warnings,
    word_count: asr?.word_count || asr?.transcription_info?.word_count || null,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      if (!env.AI) {
        return json({ ok: false, ai_ready: false, version: '4.1.1', error: 'Cloudflare Workers AI binding 未配置。' }, 503);
      }
      if (url.searchParams.get('deep') === '1') {
        const result = await deepHealth(env);
        return json(result, result.ok ? 200 : 503);
      }
      return json({
        ok: true,
        ai_ready: null,
        version: '4.1.1',
        architecture: 'public-cloud',
        gateway: GATEWAY_ID,
        asr: ASR_MODEL,
        translation: MT_MODEL,
        local_runtime_required: false,
      });
    }
    if (url.pathname === '/api/process' && request.method === 'POST') {
      if (!env.AI) return json({ ok: false, error: 'ai_binding_missing', detail: 'Cloudflare Workers AI binding 未配置。' }, 503);
      return handleProcess(request, env);
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
