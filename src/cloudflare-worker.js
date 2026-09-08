
const HEALTH_TARGETS = [
  ['Whisper config', 'onnx-community/whisper-base/resolve/main/config.json'],
  ['Whisper preprocessor', 'onnx-community/whisper-base/resolve/main/preprocessor_config.json'],
  ['M2M100 config', 'Xenova/m2m100_418M/resolve/main/config.json'],
  ['M2M100 tokenizer', 'Xenova/m2m100_418M/resolve/main/tokenizer_config.json'],
];

async function probeModel(path) {
  const url = `https://huggingface.co/${path}`;
  try {
    const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0', 'User-Agent': 'NEOVORA-Audio/3.0.3' }, redirect: 'follow' });
    // HF may answer 200 when Range is ignored, or 206 when honored.
    return { path, ok: r.ok || r.status === 206, status: r.status, contentType: r.headers.get('content-type') || '' };
  } catch (e) {
    return { path, ok: false, status: 0, error: String(e) };
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/model-health') {
      const checks = await Promise.all(HEALTH_TARGETS.map(async ([name, path]) => ({ name, ...(await probeModel(path)) })));
      const ok = checks.every(x => x.ok);
      return Response.json({ ok, version: '3.0.3', checks }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
    }

    if (url.pathname.startsWith('/hf/')) {
      const upstreamPath = url.pathname.slice('/hf/'.length);
      if (!upstreamPath || upstreamPath.includes('..')) {
        return new Response('Bad model path', { status: 400 });
      }

      const upstream = new URL(`https://huggingface.co/${upstreamPath}${url.search}`);
      const headers = new Headers();
      for (const name of ['range', 'if-none-match', 'if-modified-since', 'accept', 'accept-encoding']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set('user-agent', 'NEOVORA-Audio/3.0.3');

      let response;
      try {
        response = await fetch(upstream.toString(), {
          method: request.method === 'HEAD' ? 'HEAD' : 'GET',
          headers,
          redirect: 'follow',
        });
      } catch (error) {
        return Response.json({ ok: false, error: 'Model upstream unavailable', detail: String(error) }, { status: 502 });
      }

      const outHeaders = new Headers(response.headers);
      outHeaders.set('access-control-allow-origin', '*');
      outHeaders.set('cross-origin-resource-policy', 'cross-origin');
      outHeaders.set('x-neovora-model-proxy', '1');
      if (response.ok && !request.headers.has('range')) {
        outHeaders.set('cache-control', 'public, max-age=86400');
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders });
    }

    return env.ASSETS.fetch(request);
  }
};
