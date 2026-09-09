const ASR_MODEL = '@cf/openai/whisper-large-v3-turbo';
const TRANSLATION_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const FALLBACK_MT_MODEL = '@cf/meta/m2m100-1.2b';
const GOOGLE_WEB_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const GATEWAY_ID = 'default';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const VERSION = '4.1.4';

const SUPPORTED_LANGS = new Set([
  'zh','en','fr','es','de','it','pt','ja','ko','ru','ar','nl','pl','tr','uk','cs','sv','fi','da','el','he','hi','id'
]);

const LANG_LABELS = {
  zh: '中文', en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch', it: 'Italiano',
  pt: 'Português', ja: '日本語', ko: '한국어', ru: 'Русский', ar: 'العربية', nl: 'Nederlands',
  pl: 'Polski', tr: 'Türkçe', uk: 'Українська', cs: 'Čeština', sv: 'Svenska', fi: 'Suomi',
  da: 'Dansk', el: 'Ελληνικά', he: 'עברית', hi: 'हिन्दी', id: 'Bahasa Indonesia'
};

const ISO3_TO_ISO2 = {
  cmn:'zh', zho:'zh', eng:'en', fra:'fr', spa:'es', deu:'de', ita:'it', por:'pt', jpn:'ja', kor:'ko',
  rus:'ru', arb:'ar', ara:'ar', nld:'nl', pol:'pl', tur:'tr', ukr:'uk', ces:'cs', swe:'sv', fin:'fi',
  dan:'da', ell:'el', heb:'he', hin:'hi', ind:'id'
};

const gatewayOptions = () => ({ gateway: { id: GATEWAY_ID, skipCache: true } });

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

function normalizeLang(value) {
  if (!value) return '';
  const v = String(value).trim().toLowerCase().replace('_', '-');
  const first = v.split('-')[0];
  if (SUPPORTED_LANGS.has(first)) return first;
  const aliases = {
    chinese:'zh', mandarin:'zh', english:'en', french:'fr', spanish:'es', german:'de', italian:'it',
    portuguese:'pt', japanese:'ja', korean:'ko', russian:'ru', arabic:'ar', dutch:'nl', polish:'pl',
    turkish:'tr', ukrainian:'uk', czech:'cs', swedish:'sv', finnish:'fi', danish:'da', greek:'el',
    hebrew:'he', hindi:'hi', indonesian:'id'
  };
  return aliases[v] || ISO3_TO_ISO2[v] || '';
}

function detectByScript(text) {
  if (/\p{Script=Han}/u.test(text)) return 'zh';
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 'ja';
  if (/\p{Script=Hangul}/u.test(text)) return 'ko';
  if (/\p{Script=Arabic}/u.test(text)) return 'ar';
  if (/\p{Script=Hebrew}/u.test(text)) return 'he';
  return '';
}

const LATIN_LANGUAGE_MARKERS = {
  fr: [' le ',' la ',' les ',' des ',' de ',' du ',' un ',' une ',' et ',' est ',' sont ',' dans ',' pour ',' avec ',' que ',' qui ',' nous ',' vous ',' ils ',' elles ',' pas ',' école ',' élèves ',' enfant ',' rentrée ',' donc ',' parce ',' mais ',' très ',' être ',' on '],
  en: [' the ',' and ',' is ',' are ',' of ',' to ',' in ',' for ',' with ',' that ',' this ',' we ',' you ',' they ',' not ',' school ',' child ',' students ',' because ',' but ',' very ',' be '],
  es: [' el ',' la ',' los ',' las ',' de ',' del ',' un ',' una ',' y ',' es ',' son ',' en ',' para ',' con ',' que ',' nosotros ',' ustedes ',' no ',' escuela ',' niño ',' porque ',' pero ',' muy '],
  de: [' der ',' die ',' das ',' den ',' dem ',' ein ',' eine ',' und ',' ist ',' sind ',' in ',' für ',' mit ',' dass ',' wir ',' sie ',' nicht ',' schule ',' kind ',' weil ',' aber ',' sehr '],
  it: [' il ',' lo ',' la ',' i ',' gli ',' le ',' di ',' del ',' un ',' una ',' e ',' è ',' sono ',' in ',' per ',' con ',' che ',' noi ',' voi ',' non ',' scuola ',' bambino ',' perché ',' ma ',' molto '],
  pt: [' o ',' a ',' os ',' as ',' de ',' do ',' da ',' um ',' uma ',' e ',' é ',' são ',' em ',' para ',' com ',' que ',' nós ',' vocês ',' não ',' escola ',' criança ',' porque ',' mas ',' muito '],
  nl: [' de ',' het ',' een ',' en ',' is ',' zijn ',' in ',' voor ',' met ',' dat ',' wij ',' jullie ',' niet ',' school ',' kind ',' omdat ',' maar ',' zeer ']
};

function detectLatinLanguage(text) {
  const normalized = ` ${normalizeText(text).toLowerCase().replace(/[“”«».,!?;:()]/g, ' ')} `;
  let best = { code: '', score: 0 };
  for (const [code, markers] of Object.entries(LATIN_LANGUAGE_MARKERS)) {
    let score = 0;
    for (const marker of markers) {
      let pos = 0;
      while ((pos = normalized.indexOf(marker, pos)) !== -1) {
        score += marker.trim().length > 5 ? 2 : 1;
        pos += marker.length;
      }
    }
    if (score > best.score) best = { code, score };
  }
  return best.score >= 4 ? best.code : '';
}

async function detectTranscriptLanguage(_env, asr, transcript) {
  const directCandidates = [
    asr?.language,
    asr?.detected_language,
    asr?.transcription_info?.language,
    asr?.transcription_info?.detected_language,
    asr?.metadata?.language,
  ];
  for (const candidate of directCandidates) {
    const code = normalizeLang(candidate);
    if (code) return { code, method: 'whisper' };
  }

  const scriptCode = detectByScript(transcript);
  if (scriptCode) return { code: scriptCode, method: 'script' };

  const latinCode = detectLatinLanguage(transcript);
  if (latinCode) return { code: latinCode, method: 'text-heuristic' };

  return { code: '', method: 'unknown' };
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
  let removedRepeats = 0;

  for (let i = 0; i < rawSegments.length; i++) {
    const s = rawSegments[i] || {};
    const text = normalizeText(s.text || s.transcript || '');
    if (!text) continue;
    const sim = similarity(last, text);
    repeatRun = sim >= 0.92 ? repeatRun + 1 : 0;
    if (repeatRun >= 2) {
      removedRepeats++;
      warnings.push(`已自动拦截疑似重复片段：${text.slice(0, 80)}`);
      continue;
    }
    const start = Math.max(0, Number(s.start ?? s.start_time ?? 0) || 0);
    const endRaw = Number(s.end ?? s.end_time ?? start) || start;
    const end = Math.max(start, endRaw);
    cleaned.push({ id: cleaned.length + 1, start, end, text });
    last = text;
  }
  return { cleaned, warnings: [...new Set(warnings)], removedRepeats };
}

function timelineQuality(segments = [], removedRepeats = 0) {
  if (!segments.length) return {
    segment_count: 0, removed_repeats: removedRepeats, largest_internal_gap_seconds: 0,
    internal_gap_count: 0, speech_seconds: 0, timeline_span_seconds: 0, coverage_ratio: null
  };
  let speech = 0;
  let largestGap = 0;
  let gapCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    speech += Math.max(0, s.end - s.start);
    if (i > 0) {
      const gap = Math.max(0, s.start - segments[i - 1].end);
      largestGap = Math.max(largestGap, gap);
      if (gap >= 8) gapCount++;
    }
  }
  const span = Math.max(0, segments[segments.length - 1].end - segments[0].start);
  return {
    segment_count: segments.length,
    removed_repeats: removedRepeats,
    largest_internal_gap_seconds: Number(largestGap.toFixed(1)),
    internal_gap_count: gapCount,
    speech_seconds: Number(speech.toFixed(1)),
    timeline_span_seconds: Number(span.toFixed(1)),
    coverage_ratio: span > 0 ? Number(Math.min(1, speech / span).toFixed(3)) : null,
  };
}

function splitForTranslation(text, max = 3600) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  if (normalized.length <= max) return [normalized];
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
  const raw = typeof result === 'string'
    ? result
    : (result.response || result.translated_text || result.translation || result.text || result.result?.translated_text || '');
  return String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function runAI(env, model, input) {
  return env.AI.run(model, input, gatewayOptions());
}

const TARGET_NAMES = {
  zh: 'Simplified Chinese', en: 'English', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', ar: 'Arabic', nl: 'Dutch', pl: 'Polish',
  tr: 'Turkish', uk: 'Ukrainian', cs: 'Czech', sv: 'Swedish', fi: 'Finnish', da: 'Danish', el: 'Greek',
  he: 'Hebrew', hi: 'Hindi', id: 'Indonesian'
};

function qwenTranslationMessages(chunk, source, target, context = '') {
  const sourceName = TARGET_NAMES[source] || source;
  const targetName = TARGET_NAMES[target] || target;
  const contextPart = context
    ? `\nContext from the immediately preceding source text. Use it ONLY to resolve references and terminology; DO NOT translate it again:\n---CONTEXT---\n${context}\n---END CONTEXT---\n`
    : '';
  return [
    {
      role: 'system',
      content: `You are NEOVORA's professional ${sourceName} to ${targetName} translation engine. Translate faithfully and completely. Do not summarize, explain, omit, embellish, infer facts that are not present, or add headings. Preserve all numbers, times, names, school/administrative terminology and speaker intent. Repair only obvious spoken-language disfluencies when needed for natural ${targetName}. If the source is awkward or ambiguous, preserve the ambiguity rather than inventing meaning. Output ONLY the translation, with natural paragraphing. Never output reasoning or <think> tags.`
    },
    {
      role: 'user',
      content: `${contextPart}\nTranslate the following source text into ${targetName}:\n---SOURCE---\n${chunk}\n---END SOURCE---`
    }
  ];
}



function googleTargetLang(code) {
  const map = { zh: 'zh-CN' };
  return map[code] || code;
}

function parseGoogleTranslatePayload(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return '';
  return payload[0]
    .map(part => Array.isArray(part) ? (part[0] || '') : '')
    .join('')
    .trim();
}

async function translateWithGoogleWeb(text, source, target) {
  const chunks = splitForTranslation(text, 2200);
  const results = [];
  for (const chunk of chunks) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const params = new URLSearchParams({
        client: 'gtx',
        sl: source || 'auto',
        tl: googleTargetLang(target),
        dt: 't',
        q: chunk,
      });
      const response = await fetch(`${GOOGLE_WEB_TRANSLATE_URL}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'accept': 'application/json,text/plain,*/*',
          'user-agent': 'Mozilla/5.0 NEOVORA-Audio/4.1.4',
        },
        signal: controller.signal,
      });
      if (response.status === 429) throw new Error('Google Web Translate 429 Too Many Requests');
      if (!response.ok) throw new Error(`Google Web Translate HTTP ${response.status}`);
      const data = await response.json();
      const translated = parseGoogleTranslatePayload(data);
      if (!translated) throw new Error('Google Web Translate 未返回有效译文');
      results.push(translated);
    } finally {
      clearTimeout(timer);
    }
  }
  return results.join('\n\n');
}

async function translateWithQwen(env, text, source, target) {
  const chunks = splitForTranslation(text);
  const results = [];
  let previousContext = '';
  for (const chunk of chunks) {
    const estimatedMaxTokens = Math.min(4096, Math.max(768, Math.ceil(chunk.length * 1.6)));
    const r = await runAI(env, TRANSLATION_MODEL, {
      messages: qwenTranslationMessages(chunk, source, target, previousContext),
      max_tokens: estimatedMaxTokens,
      temperature: 0.1,
      top_p: 0.9,
      repetition_penalty: 1.05,
      seed: 17,
    });
    const t = extractTranslation(r);
    if (!t) throw new Error('高质量翻译模型未返回有效文本。');
    results.push(t);
    previousContext = chunk.slice(-700);
  }
  return results.join('\n\n');
}

async function translateWithFallback(env, text, source, target) {
  const chunks = splitForTranslation(text, 1200);
  const results = [];
  for (const chunk of chunks) {
    const r = await runAI(env, FALLBACK_MT_MODEL, { text: chunk, source_lang: source, target_lang: target });
    const t = extractTranslation(r);
    if (!t) throw new Error('备用翻译模型未返回有效文本。');
    results.push(t);
  }
  return results.join('\n\n');
}

async function translateText(env, text, source, target) {
  if (!text || target === 'none') return { text: '', engine: null, fallback: false };
  if (!SUPPORTED_LANGS.has(source)) throw new Error('无法可靠识别原语言，请手动选择原语言后重试翻译。');
  if (!SUPPORTED_LANGS.has(target)) throw new Error('当前目标语言暂不受支持。');
  if (source === target) return { text, engine: 'same-language', fallback: false };

  let googleError = null;
  try {
    const translated = await translateWithGoogleWeb(text, source, target);
    return { text: translated, engine: 'google-web', fallback: false };
  } catch (e) {
    googleError = e;
  }

  let qwenError = null;
  try {
    const translated = await translateWithQwen(env, text, source, target);
    return {
      text: translated,
      engine: 'quality',
      fallback: true,
      primary_error: String(googleError?.message || googleError),
    };
  } catch (e) {
    qwenError = e;
  }

  try {
    const translated = await translateWithFallback(env, text, source, target);
    return {
      text: translated,
      engine: 'fallback',
      fallback: true,
      primary_error: String(googleError?.message || googleError),
      secondary_error: String(qwenError?.message || qwenError),
    };
  } catch (fallbackError) {
    throw new Error(`Google Web、Qwen3 与 M2M100 翻译均失败：${String(googleError?.message || googleError)} / ${String(qwenError?.message || qwenError)} / ${String(fallbackError?.message || fallbackError)}`);
  }
}
async function deepHealth(env) {
  const started = Date.now();
  const checks = { gateway: GATEWAY_ID, google_web_translation: null, quality_translation: false, fallback_translation: null, asr: false };
  try {
    try {
      checks.google_web_translation = Boolean(await translateWithGoogleWeb('Bonjour, les élèves arrivent à 8h20.', 'fr', 'zh'));
    } catch (e) {
      checks.google_web_translation = false;
      checks.google_web_error = String(e?.message || e);
    }
    const qwen = await runAI(env, TRANSLATION_MODEL, {
      messages: qwenTranslationMessages('Bonjour, les élèves arrivent à 8h20.', 'fr', 'zh'),
      max_tokens: 128,
      temperature: 0.1,
      seed: 17,
    });
    checks.quality_translation = Boolean(extractTranslation(qwen));
    await runAI(env, ASR_MODEL, {
      audio: createProbeWavBase64(), task: 'transcribe', vad_filter: true,
      condition_on_previous_text: false, no_speech_threshold: 0.6,
    });
    checks.asr = true;
    const ready = checks.quality_translation && checks.asr;
    return {
      ok: ready, ai_ready: ready, version: VERSION,
      architecture: 'public-cloud-free-hybrid', gateway: GATEWAY_ID, checks,
      latency_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false, ai_ready: false, version: VERSION, architecture: 'public-cloud-free-hybrid', gateway: GATEWAY_ID,
      checks, error: String(e?.message || e), latency_ms: Date.now() - started,
    };
  }
}
async function handleProcess(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  const sourceRequested = String(form.get('source_lang') || 'auto');
  const target = String(form.get('target_lang') || 'none');
  const quality = String(form.get('quality') || 'high');

  if (!(file instanceof File)) return json({ ok: false, error: 'missing_file', detail: '请选择音频文件。' }, 400);
  if (file.size <= 0) return json({ ok: false, error: 'empty_file', detail: '文件为空。' }, 400);
  if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: 'file_too_large', detail: '当前单文件上限 20 MB。长音频队列正在后续版本扩展。' }, 413);

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
  if (sourceRequested !== 'auto') payload.language = sourceRequested;

  let asr;
  try {
    asr = await runAI(env, ASR_MODEL, payload);
  } catch (e) {
    const message = String(e?.message || e);
    const gatewayHint = /2001|gateway/i.test(message)
      ? 'AI Gateway 未就绪，请重新运行一键部署并确认最后的 AI 深度自检通过。'
      : '';
    return json({
      ok: false, error: 'asr_failed',
      detail: `Cloudflare Whisper 处理失败：${message}${gatewayHint ? `\n${gatewayHint}` : ''}`,
    }, 502);
  }

  const rawText = normalizeText(asr?.text || asr?.transcription_info?.text || '');
  const rawSegments = Array.isArray(asr?.segments) ? asr.segments : [];
  const { cleaned, warnings, removedRepeats } = cleanSegments(rawSegments);
  const transcript = cleaned.length ? cleaned.map(s => s.text).join(' ') : rawText;
  if (!transcript) return json({ ok: false, error: 'empty_transcript', detail: '没有识别到可靠语音内容。' }, 422);

  const detected = sourceRequested === 'auto'
    ? await detectTranscriptLanguage(env, asr, transcript)
    : { code: normalizeLang(sourceRequested), method: 'manual' };
  const effectiveSource = detected.code;
  const qualityMetrics = timelineQuality(cleaned, removedRepeats);

  if (qualityMetrics.internal_gap_count > 0 && qualityMetrics.largest_internal_gap_seconds >= 12) {
    warnings.push(`检测到 ${qualityMetrics.largest_internal_gap_seconds.toFixed(1)} 秒的较长语音间隔；可能是静音，也可能需要复核该时间段。`);
  }

  let translation = '';
  let translation_error = '';
  let translation_engine = null;
  let translation_fallback = false;
  if (target !== 'none') {
    try {
      const translatedResult = await translateText(env, transcript, effectiveSource, target);
      translation = translatedResult.text;
      translation_engine = translatedResult.engine;
      translation_fallback = Boolean(translatedResult.fallback);
      if (translation_engine === 'quality') warnings.push('Google 免费翻译节点本次不可用，已自动切换到高质量备用翻译。');
      if (translation_engine === 'fallback') warnings.push('Google 与高质量备用节点均不可用，本次已使用基础翻译兜底。');
    } catch (e) {
      translation_error = String(e?.message || e);
    }
  }

  return json({
    ok: true,
    version: VERSION,
    provider: 'hybrid-free-google-cloudflare', gateway: GATEWAY_ID,
    asr_model: ASR_MODEL, primary_translation: 'google-web-unofficial', translation_model: TRANSLATION_MODEL, fallback_translation_model: FALLBACK_MT_MODEL,
    source_requested: sourceRequested,
    detected_language: effectiveSource || null,
    detected_language_label: effectiveSource ? (LANG_LABELS[effectiveSource] || effectiveSource) : null,
    language_detection_method: detected.method,
    transcript,
    translation,
    translation_error,
    translation_engine,
    translation_fallback,
    segments: cleaned,
    vtt: asr?.vtt || '',
    warnings: [...new Set(warnings)],
    quality: qualityMetrics,
    word_count: asr?.word_count || asr?.transcription_info?.word_count || null,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      if (!env.AI) return json({ ok: false, ai_ready: false, version: VERSION, error: 'Cloudflare Workers AI binding 未配置。' }, 503);
      if (url.searchParams.get('deep') === '1') {
        const result = await deepHealth(env);
        return json(result, result.ok ? 200 : 503);
      }
      return json({
        ok: true, ai_ready: null, version: VERSION, architecture: 'public-cloud', gateway: GATEWAY_ID,
        asr: ASR_MODEL, translation_primary: 'google-web-unofficial', translation: TRANSLATION_MODEL, fallback_translation: FALLBACK_MT_MODEL, local_runtime_required: false,
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
