// Read-only GitHub integration: link a repo to a space, browse commits / pull requests / branches / README,
// and show activity that mentions an issue key (e.g. ENG-12) on the issue itself.
import { esc, icon, renderMarkdown } from './render.js';
import { str, wrap } from './util.js';

// GitHub owner names: letters, digits and single hyphens, never starting with a dot. Repo names may contain dots but are never "." or "..".
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
export function validRepo(repo) {
  if (typeof repo !== 'string') return false;
  const [owner, name, ...rest] = repo.split('/');
  return !rest.length && OWNER.test(owner ?? '') && NAME.test(name ?? '');
}
const API = 'https://api.github.com';

// Errors whose text is safe to show to people; anything else is reported generically.
const publicError = (message) => Object.assign(new Error(message), { public: true });

export function createGithub({ token = '', fetchFn = globalThis.fetch, ttlMs = 5 * 60e3 } = {}) {
  const cache = new Map();
  async function get(path) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    // Whatever we are asked for, only /repos/... on api.github.com may be fetched (the token is attached to these requests).
    const url = new URL(path, API);
    if (url.origin !== API || !url.pathname.startsWith('/repos/') || url.pathname.includes('/../')) throw publicError('Refused to contact an unexpected GitHub address');
    const res = await fetchFn(url.href, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'folio-wiki', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = publicError(res.status === 404 ? 'Repository not found (is it private? set FOLIO_GITHUB_TOKEN)' : res.status === 403 || res.status === 429 ? 'GitHub rate limit reached. Set FOLIO_GITHUB_TOKEN to raise it.' : `GitHub returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    cache.set(path, { at: Date.now(), data });
    return data;
  }
  return {
    valid: validRepo,
    repo: (r) => get(`/repos/${r}`),
    commits: (r) => get(`/repos/${r}/commits?per_page=50`),
    pulls: (r) => get(`/repos/${r}/pulls?state=all&sort=updated&direction=desc&per_page=40`),
    branches: (r) => get(`/repos/${r}/branches?per_page=50`),
    readme: (r) => get(`/repos/${r}/readme`),
    clear: () => cache.clear(),
  };
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  for (const [n, u] of [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
};
const ext = (href) => `href="${esc(href)}" target="_blank" rel="noopener noreferrer"`;

export function mountGithub(app, { db, page, getSpace, github }) {
  // Turn "ENG-12" in already-escaped text into a link to the issue, when it exists in this space.
  const linkKeys = (text, space) =>
    esc(text).replace(new RegExp(`\\b${space.key}-(\\d+)\\b`, 'g'), (m, n) => {
      const i = db.prepare('SELECT id FROM issues WHERE space_id = ? AND num = ?').get(space.id, Number(n));
      return i ? `<a class="issue-link" href="/i/${i.id}">${m}</a>` : m;
    });

  const tabs = (space, tab) => ['commits', 'pulls', 'branches', 'readme'].map((t) =>
    `<a class="tab${tab === t ? ' on' : ''}" href="/s/${esc(space.key)}/code?tab=${t}">${{ commits: 'Commits', pulls: 'Pull requests', branches: 'Branches', readme: 'README' }[t]}</a>`).join('');

  const prState = (p) => (p.merged_at ? ['merged', 'Merged'] : p.state === 'open' ? ['open', p.draft ? 'Draft' : 'Open'] : ['closed', 'Closed']);

  app.get('/s/:key/code', wrap(async (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const head = `<div class="jira"><nav class="crumbs"><a href="/">Spaces</a>${icon('chevron')}<a href="/s/${esc(space.key)}">${esc(space.name)}</a>${icon('chevron')}Code</nav>`;
    const done = (body, status = 200) => { res.status(status); page(res, { title: 'Code', user: req.user, space, section: 'code', toc: false, body: `${head}${body}</div>` }); };
    if (!space.github_repo)
      return done(`<h1 class="page-title">Code</h1><div class="empty">${icon('branch')}<h3>Link a GitHub repository</h3>
        <p>Browse commits, pull requests and branches here, and see which ones mention your issue keys (like <b>${esc(space.key)}-1</b>). Read-only: Folio never writes to GitHub.</p>
        <form class="new-space center" method="post" action="/s/${esc(space.key)}/code/link"><input name="repo" placeholder="owner/repository, e.g. tombrooksdev/Folio" aria-label="Repository" required pattern="[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+"><button>Link repository</button></form>
        <p class="muted">Public repositories work out of the box. For private repositories or higher rate limits, set <code>FOLIO_GITHUB_TOKEN</code> on the server.</p></div>`);
    const r = space.github_repo;
    if (!github.valid(r)) return done(`<h1 class="page-title">Code</h1><div class="err" role="alert">The linked repository name is not valid.</div><form method="post" action="/s/${esc(space.key)}/code/unlink" class="actions"><button class="ghost">Unlink repository</button></form>`, 400);
    const tab = ['commits', 'pulls', 'branches', 'readme'].includes(req.query.tab) ? req.query.tab : 'commits';
    try {
      const info = await github.repo(r);
      let list = '';
      if (tab === 'commits') {
        const commits = await github.commits(r);
        list = `<div class="list">${commits.map((c) => `<div class="row-item commit"><span class="t">${linkKeys(c.commit.message.split('\n')[0], space)}</span><span class="s">${esc(c.commit.author?.name ?? c.author?.login ?? '')} · ${esc(ago(c.commit.author?.date ?? c.commit.committer?.date))} · <a ${ext(c.html_url)}><code>${esc(c.sha.slice(0, 7))}</code></a></span></div>`).join('') || '<p class="muted pad">No commits.</p>'}</div>`;
      } else if (tab === 'pulls') {
        const pulls = await github.pulls(r);
        list = `<div class="list">${pulls.map((p) => { const [cls, text] = prState(p); return `<div class="row-item commit"><span class="pr-state pr-${cls}">${text}</span><span class="t"><a ${ext(p.html_url)}>#${p.number}</a> ${linkKeys(p.title, space)}</span><span class="s">${esc(p.user?.login ?? '')} · ${esc(ago(p.updated_at))} · ${esc(p.head?.ref ?? '')}</span></div>`; }).join('') || '<p class="muted pad">No pull requests.</p>'}</div>`;
      } else if (tab === 'branches') {
        const branches = await github.branches(r);
        list = `<div class="list">${branches.map((b) => `<div class="row-item commit">${icon('branch')}<span class="t"><a ${ext(`${info.html_url}/tree/${encodeURIComponent(b.name)}`)}>${linkKeys(b.name, space)}</a>${b.name === info.default_branch ? ' <span class="chip st-todo">default</span>' : ''}${b.protected ? ' <span class="chip st-doing">protected</span>' : ''}</span><span class="s"><code>${esc(b.commit.sha.slice(0, 7))}</code></span></div>`).join('')}</div>`;
      } else {
        const rd = await github.readme(r);
        list = `<article class="doc">${renderMarkdown(Buffer.from(rd.content ?? '', 'base64').toString('utf8'))}</article>`;
      }
      done(`<div class="j-head"><div><h1 class="page-title"><a class="repo-name" ${ext(info.html_url)}>${esc(info.full_name)}</a></h1>
          <p class="muted">${esc(info.description ?? '')}</p>
          <p class="meta"><span>${icon('branch')}${esc(info.default_branch)}</span>${info.language ? `<span>${esc(info.language)}</span>` : ''}<span>${info.stargazers_count} stars</span><span>${info.forks_count} forks</span><span>${info.open_issues_count} open issues</span></p></div>
          <div class="actions"><a class="btn ghost" ${ext(info.html_url)}>Open on GitHub</a>
          <form method="post" action="/s/${esc(space.key)}/code/unlink" data-confirm="Unlink this repository?"><button class="ghost">Unlink</button></form></div></div>
        <div class="tabs">${tabs(space, tab)}</div>${list}`);
    } catch (e) {
      if (!e.public) console.error('GitHub view failed:', e);
      done(`<h1 class="page-title">${esc(r)}</h1><div class="err" role="alert">${esc(e.public ? e.message : 'Could not load this repository from GitHub right now.')}</div>
        <form method="post" action="/s/${esc(space.key)}/code/unlink" class="actions"><button class="ghost">Unlink repository</button></form>`, 502);
    }
  }));

  app.post('/s/:key/code/link', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    const repo = str(req.body.repo, 200).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!github.valid(repo)) return res.status(400).send('Use the form owner/repository');
    db.prepare('UPDATE spaces SET github_repo = ? WHERE id = ?').run(repo, space.id);
    res.redirect(`/s/${space.key}/code`);
  });
  app.post('/s/:key/code/unlink', (req, res) => {
    const space = getSpace(req.params.key);
    if (!space) return res.status(404).send('No such space');
    db.prepare('UPDATE spaces SET github_repo = NULL WHERE id = ?').run(space.id);
    res.redirect(`/s/${space.key}/code`);
  });

  // "Development" panel on an issue: commits and PRs whose text mentions the issue key. Loaded lazily by the page.
  app.get('/i/:id/dev', wrap(async (req, res) => {
    const i = db.prepare('SELECT * FROM issues WHERE id = ?').get(Number(req.params.id));
    const space = i && db.prepare('SELECT * FROM spaces WHERE id = ?').get(i.space_id);
    if (!i || !space?.github_repo || !github.valid(space.github_repo)) return res.status(404).send('');
    const key = new RegExp(`\\b${space.key}-${i.num}\\b`);
    try {
      const [pulls, commits] = await Promise.all([github.pulls(space.github_repo), github.commits(space.github_repo)]);
      const prs = pulls.filter((p) => key.test(p.title) || key.test(p.head?.ref ?? '') || key.test(p.body ?? ''));
      const cs = commits.filter((c) => key.test(c.commit.message));
      res.type('html').send(`<h3>Development</h3><div class="dev-body">
        ${prs.map((p) => { const [cls, text] = prState(p); return `<div class="dev-row"><span class="pr-state pr-${cls}">${text}</span><a ${ext(p.html_url)}>#${p.number} ${esc(p.title)}</a></div>`; }).join('')}
        ${cs.map((c) => `<div class="dev-row">${icon('branch')}<a ${ext(c.html_url)}>${esc(c.commit.message.split('\n')[0])}</a><code>${esc(c.sha.slice(0, 7))}</code></div>`).join('')}
        ${prs.length || cs.length ? '' : `<p class="muted">No pull requests or commits mention ${esc(space.key)}-${i.num} yet. Put the key in a commit message, PR title or branch name.</p>`}</div>`);
    } catch (e) {
      if (!e.public) console.error('GitHub development panel failed:', e);
      res.type('html').send(`<h3>Development</h3><p class="muted pad">${esc(e.public ? e.message : 'Could not load GitHub activity.')}</p>`);
    }
  }));
}
