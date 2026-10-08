// 게시판 백엔드 — Cloudflare Workers + KV
// GET    /api/posts        글 목록 (최신순, 최대 50개)
// POST   /api/posts        글 등록 {name, content, password}
// DELETE /api/posts/:id    글 삭제 {password}

const MAX_NAME = 20;
const MAX_CONTENT = 500;
const MAX_POSTS = 50;

const CORS = {
  "Access-Control-Allow-Origin": "*", // 배포 후 내 프론트 주소로 바꾸면 더 안전해요
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 최신 글이 먼저 나오도록 키에 (큰 수 - 현재시각)을 넣어요
const makeKey = (id) => `post:${String(9999999999999 - Date.now()).padStart(13, "0")}:${id}`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","posts",":id"]
    if (parts[0] !== "api" || parts[1] !== "posts") return json({ error: "Not found" }, 404);

    // 목록
    if (request.method === "GET" && parts.length === 2) {
      const list = await env.POSTS.list({ prefix: "post:", limit: MAX_POSTS });
      const posts = await Promise.all(
        list.keys.map(async (k) => {
          const p = JSON.parse(await env.POSTS.get(k.name));
          return { id: p.id, name: p.name, content: p.content, createdAt: p.createdAt };
        })
      );
      return json(posts);
    }

    // 등록
    if (request.method === "POST" && parts.length === 2) {
      let body;
      try { body = await request.json(); } catch { return json({ error: "잘못된 요청이에요." }, 400); }

      const name = String(body.name ?? "").trim();
      const content = String(body.content ?? "").trim();
      const password = String(body.password ?? "");

      if (!name || name.length > MAX_NAME) return json({ error: `이름은 1~${MAX_NAME}자로 입력해 주세요.` }, 400);
      if (!content || content.length > MAX_CONTENT) return json({ error: `내용은 1~${MAX_CONTENT}자로 입력해 주세요.` }, 400);
      if (password.length < 4) return json({ error: "비밀번호는 4자 이상 입력해 주세요." }, 400);

      const id = crypto.randomUUID();
      const post = {
        id, name, content,
        createdAt: new Date().toISOString(),
        passwordHash: await sha256(id + password),
      };
      await env.POSTS.put(makeKey(id), JSON.stringify(post));
      return json({ id, name, content, createdAt: post.createdAt }, 201);
    }

    // 삭제
    if (request.method === "DELETE" && parts.length === 3) {
      const id = parts[2];
      let body = {};
      try { body = await request.json(); } catch {}

      const list = await env.POSTS.list({ prefix: "post:" });
      const key = list.keys.find((k) => k.name.endsWith(`:${id}`));
      if (!key) return json({ error: "이미 삭제됐거나 없는 글이에요." }, 404);

      const post = JSON.parse(await env.POSTS.get(key.name));
      if (post.passwordHash !== (await sha256(id + String(body.password ?? "")))) {
        return json({ error: "비밀번호가 맞지 않아요." }, 403);
      }
      await env.POSTS.delete(key.name);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  },
};
