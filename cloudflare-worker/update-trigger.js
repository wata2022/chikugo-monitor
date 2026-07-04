const DEFAULT_ALLOWED_ORIGIN = "https://wata2022.github.io";

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
  };
}

function isAuthorized(request, env) {
  const expectedKey = env.UPDATE_KEY;
  if (!expectedKey) {
    return false;
  }
  const authorization = request.headers.get("authorization") || "";
  return authorization === `Bearer ${expectedKey}`;
}

function getAllowedOrigin(request, env) {
  const requestOrigin = request.headers.get("origin") || "";
  const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
  return requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;
}

async function dispatchWorkflow(env) {
  const owner = env.GITHUB_OWNER || "wata2022";
  const repo = env.GITHUB_REPO || "chikugo-monitor";
  const workflowId = env.GITHUB_WORKFLOW_ID || "update.yml";
  const ref = env.GITHUB_REF || "master";
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "user-agent": "chikugo-monitor-update-trigger",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`GitHub API ${response.status}: ${responseText}`);
  }
}

export default {
  async fetch(request, env) {
    const origin = getAllowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, origin);
    }

    if (!env.GITHUB_TOKEN) {
      return jsonResponse({ error: "GITHUB_TOKEN is not configured." }, 500, origin);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized." }, 401, origin);
    }

    try {
      await dispatchWorkflow(env);
      return jsonResponse({ ok: true }, 202, origin);
    } catch (error) {
      return jsonResponse({ error: error.message }, 502, origin);
    }
  },
};
