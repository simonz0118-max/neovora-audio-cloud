export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
      headers.set('user-agent', 'NEOVORA-Audio/3.0.1');

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
