const ASR_MODEL = '@cf/openai/whisper-large-v3-turbo';
const MT_MODEL = '@cf/meta/m2m100-1.2b';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const LANG_NAMES = {
  zh: 'chinese', en: 'english', fr: 'french', es: 'spanish', de: 'german', it: 'italian',
  pt: 'portuguese', ja: 'japanese', ko: 'korean', ru: 'russian', ar: 'arabic', nl: 'dutch',
  pl: 'polish', tr: 'turkish', uk: 'ukrainian', cs: 'czech', sv: 'swedish', fi: 'finnish',
  da: 'danish', el: 'greek', he: 'hebrew', hi: 'hindi', id: 'indonesian'
};

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

async function translateText(env, text, source, target) {
  if (!text || target === 'none' || source === target) return source === target ? text : '';
  if (source === 'auto') throw new Error('自动检测可用于转写；当前公网翻译请明确选择原语言，以保证翻译方向正确。');
  const chunks = splitForTranslation(text);
  const results = [];
  for (const chunk of chunks) {
    const r = await env.AI.run(MT_MODEL, {
      text: chunk,
      source_lang: LANG_NAMES[source] || source,
      target_lang: LANG_NAMES[target] || target
    }, { gateway: { id: 'neovora-audio' } });
    const t = extractTranslation(r);
    if (!t) throw new Error('翻译模型未返回有效文本');
    results.push(t);
  }
  return results.join('\n\n');
}

async function handleProcess(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  const source = String(form.get('source_lang') || 'auto');
  const target = String(form.get('target_lang') || 'none');
  const quality = String(form.get('quality') || 'high');

  if (!(file instanceof File)) return json({ ok: false, error: 'missing_file', detail: '请选择音频文件。' }, 400);
  if (file.size <= 0) return json({ ok: false, error: 'empty_file', detail: '文件为空。' }, 400);
  if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: 'file_too_large', detail: 'V4.1 Cloud 首版单文件上限 20 MB。长音频分块队列将在下一阶段加入。' }, 413);

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
    hallucination_silence_threshold: 1.0
  };
  if (source !== 'auto') payload.language = source;

  let asr;
  try {
    asr = await env.AI.run(ASR_MODEL, payload, { gateway: { id: 'neovora-audio' } });
  } catch (e) {
    return json({ ok: false, error: 'asr_failed', detail: `Cloudflare Whisper 处理失败：${e?.message || e}` }, 502);
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
    version: '4.1.0',
    provider: 'cloudflare-workers-ai',
    asr_model: ASR_MODEL,
    translation_model: MT_MODEL,
    transcript,
    translation,
    translation_error,
    segments: cleaned,
    vtt: asr?.vtt || '',
    warnings,
    word_count: asr?.word_count || asr?.transcription_info?.word_count || null
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({
        ok: Boolean(env.AI),
        version: '4.1.0',
        architecture: 'public-cloud',
        asr: ASR_MODEL,
        translation: MT_MODEL,
        local_runtime_required: false
      }, env.AI ? 200 : 503);
    }
    if (url.pathname === '/api/process' && request.method === 'POST') {
      if (!env.AI) return json({ ok: false, error: 'ai_binding_missing', detail: 'Cloudflare Workers AI binding 未配置。' }, 503);
      return handleProcess(request, env);
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
