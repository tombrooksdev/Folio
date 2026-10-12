// In-app notifications (bell, list, preferences), watching, @mentions and an optional team webhook.
import { esc, icon, hueClass } from './render.js';

export const KINDS = {
  page_created: ['New pages', 'Someone creates a page'],
  issue_created: ['New issues', 'Someone creates an issue'],
  page_updated: ['Page updates', 'A page you watch is edited'],
  issue_updated: ['Issue updates', 'An issue you watch changes'],
  page_comment: ['Page comments', 'Someone comments on a page you watch'],
  issue_comment: ['Issue comments', 'Someone comments on an issue you watch'],
  assigned: ['Assigned to you', 'An issue is assigned to you'],
  mention: ['Mentions', 'Someone @mentions you'],
  sprint: ['Sprints', 'A sprint starts or is completed'],
};
const TEAM_KINDS = new Set(['page_created', 'issue_created', 'sprint']); // also posted to the webhook, if configured
const COALESCE = new Set(['page_updated', 'issue_updated']);
const ago = (at) => {
  const s = Math.max(0, (Date.now() - new Date(`${at.replace(' ', 'T')}Z`)) / 1000);
  for (const [n, u] of [[86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
};

export function createNotifier({ db, webhookUrl = '', publicUrl = '', fetchFn = globalThis.fetch }) {
  const prefOn = (userId, kind) => (db.prepare('SELECT value FROM user_flags WHERE user_id = ? AND key = ?').get(userId, `pref:${kind}`)?.value ?? '1') === '1';
  const everyone = () => db.prepare('SELECT id FROM users').all().map((u) => u.id);
  const watchersOf = (kind, ref) => db.prepare('SELECT user_id FROM watchers WHERE kind = ? AND ref_id = ?').all(kind, ref).map((w) => w.user_id);

  const n = {
    watch: (userId, kind, ref) => db.prepare('INSERT OR IGNORE INTO watchers (user_id, kind, ref_id) VALUES (?, ?, ?)').run(userId, kind, ref),
    unwatch: (userId, kind, ref) => db.prepare('DELETE FROM watchers WHERE user_id = ? AND kind = ? AND ref_id = ?').run(userId, kind, ref),
    isWatching: (userId, kind, ref) => !!db.prepare('SELECT 1 FROM watchers WHERE user_id = ? AND kind = ? AND ref_id = ?').get(userId, kind, ref),
    watcherCount: (kind, ref) => db.prepare('SELECT COUNT(*) n FROM watchers WHERE kind = ? AND ref_id = ?').get(kind, ref).n,

    // ids of users @mentioned in some text
    mentioned(text) {
      const ids = new Set();
      for (const m of String(text ?? '').matchAll(/(?:^|[^\w@])@([A-Za-z0-9._-]{1,32})/g)) {
        const u = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(m[1]);
        if (u) ids.add(u.id);
      }
      return ids;
    },

    // recipients: Map(userId -> kind). The actor never hears about their own actions; preferences are honoured.
    deliver(recipients, { actor, text, url, ref }) {
      for (const [userId, kind] of recipients) {
        if (userId === actor?.id || !prefOn(userId, kind)) continue;
        if (COALESCE.has(kind)) {
          const hit = db.prepare("SELECT id FROM notifications WHERE user_id = ? AND kind = ? AND ref = ? AND read_at IS NULL AND created_at > datetime('now', '-10 minutes')").get(userId, kind, ref);
          if (hit) { db.prepare("UPDATE notifications SET text = ?, actor_id = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?").run(text, actor?.id ?? null, hit.id); continue; }
        }
        db.prepare('INSERT INTO notifications (user_id, kind, actor_id, ref, text, url) VALUES (?, ?, ?, ?, ?, ?)').run(userId, kind, actor?.id ?? null, ref ?? null, text, url);
      }
    },
    // add mention recipients (highest priority) for each text
    withMentions(recipients, ...texts) {
      for (const t of texts) for (const id of n.mentioned(t)) recipients.set(id, 'mention');
      return recipients;
    },
    post(kind, text, url) {
      if (!webhookUrl || !TEAM_KINDS.has(kind)) return;
      const link = publicUrl ? ` ${publicUrl.replace(/\/$/, '')}${url}` : '';
      fetchFn(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `${text}${link}`, content: `${text}${link}` }), signal: AbortSignal.timeout(5000) })
        .catch((e) => console.error('webhook failed:', e.message));
    },

    // ---- events ----
    pageCreated(p, space, actor) {
      n.watch(actor.id, 'page', p.id);
      const text = `${actor.username} created the page "${p.title}" in ${space.name}`;
      const r = n.withMentions(new Map(everyone().map((id) => [id, 'page_created'])), p.body);
      n.deliver(r, { actor, text, url: `/p/${p.id}`, ref: `page:${p.id}` });
      n.post('page_created', text, `/p/${p.id}`);
    },
    pageUpdated(p, space, actor, oldBody) {
      n.watch(actor.id, 'page', p.id);
      const r = new Map(watchersOf('page', p.id).map((id) => [id, 'page_updated']));
      const fresh = [...n.mentioned(p.body)].filter((id) => !n.mentioned(oldBody).has(id));
      for (const id of fresh) r.set(id, 'mention');
      n.deliver(r, { actor, text: `${actor.username} updated the page "${p.title}"`, url: `/p/${p.id}`, ref: `page:${p.id}` });
    },
    pageComment(p, actor, body, replyToUserId) {
      n.watch(actor.id, 'page', p.id);
      const r = new Map(watchersOf('page', p.id).map((id) => [id, 'page_comment']));
      if (replyToUserId) r.set(replyToUserId, 'page_comment');
      n.withMentions(r, body);
      n.deliver(r, { actor, text: `${actor.username} commented on "${p.title}": ${body.slice(0, 80)}`, url: `/p/${p.id}`, ref: `page-comment:${p.id}` });
    },
    issueCreated(i, space, actor) {
      const key = `${space.key}-${i.num}`;
      n.watch(actor.id, 'issue', i.id);
      const r = new Map(everyone().map((id) => [id, 'issue_created']));
      if (i.assignee_id) { r.set(i.assignee_id, 'assigned'); n.watch(i.assignee_id, 'issue', i.id); }
      n.withMentions(r, i.description);
      const text = `${actor.username} created ${key} ${i.title}`;
      n.deliver(r, { actor, text, url: `/i/${i.id}`, ref: `issue:${i.id}` });
      n.post('issue_created', text, `/i/${i.id}`);
    },
    // changes: [{field, from, to}] as returned by recordChanges
    issueChanged(i, space, actor, changes, newMentionText = '') {
      if (!changes.length) return;
      const key = `${space.key}-${i.num}`;
      n.watch(actor.id, 'issue', i.id);
      const r = new Map(watchersOf('issue', i.id).map((id) => [id, 'issue_updated']));
      const assign = changes.find((c) => c.field === 'assignee_id');
      if (assign) {
        const u = db.prepare('SELECT id FROM users WHERE username = ?').get(assign.to);
        if (u) { r.set(u.id, 'assigned'); n.watch(u.id, 'issue', i.id); }
      }
      n.withMentions(r, newMentionText);
      const names = { status: 'Status', assignee_id: 'Assignee', priority: 'Priority', points: 'Story points', sprint_id: 'Sprint', epic_id: 'Epic', type: 'Type', title: 'Summary', labels: 'Labels', parent_id: 'Parent', description: 'Description' };
      const one = changes.length === 1 ? changes[0] : null;
      const text = one && one.field !== 'description' ? `${actor.username} changed ${names[one.field] ?? one.field} of ${key} from ${one.from} to ${one.to}`
        : one ? `${actor.username} updated the description of ${key}`
        : `${actor.username} updated ${key} (${changes.map((c) => names[c.field] ?? c.field).join(', ')})`;
      n.deliver(r, { actor, text, url: `/i/${i.id}`, ref: `issue:${i.id}` });
      // a direct "assigned to you" message reads better than the generic one
      if (assign) {
        const u = db.prepare('SELECT id FROM users WHERE username = ?').get(assign.to);
        if (u && u.id !== actor.id && prefOn(u.id, 'assigned')) {
          db.prepare("DELETE FROM notifications WHERE user_id = ? AND ref = ? AND kind = 'assigned' AND read_at IS NULL AND text NOT LIKE '%assigned%'").run(u.id, `issue:${i.id}`);
          db.prepare("UPDATE notifications SET text = ? WHERE user_id = ? AND ref = ? AND kind = 'assigned' AND read_at IS NULL").run(`${actor.username} assigned ${key} to you`, u.id, `issue:${i.id}`);
        }
      }
    },
    issueComment(i, space, actor, body) {
      n.watch(actor.id, 'issue', i.id);
      const r = new Map(watchersOf('issue', i.id).map((id) => [id, 'issue_comment']));
      n.withMentions(r, body);
      n.deliver(r, { actor, text: `${actor.username} commented on ${space.key}-${i.num}: ${body.slice(0, 80)}`, url: `/i/${i.id}`, ref: `issue-comment:${i.id}` });
    },
    sprintEvent(s, space, actor, verb) {
      const text = `${actor.username} ${verb} ${s.name} in ${space.name}`;
      const url = verb === 'started' ? `/s/${space.key}/board` : `/s/${space.key}/reports`;
      n.deliver(new Map(everyone().map((id) => [id, 'sprint'])), { actor, text, url, ref: `sprint:${s.id}` });
      n.post('sprint', text, url);
    },
  };
  return n;
}

export const unreadCount = (db, userId) => db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

const item = (nt) => `<a class="note${nt.read_at ? '' : ' unread'}" href="/notifications/${nt.id}/go">
  <span class="avatar sm-av ${hueClass(nt.actor ?? '?')}">${esc((nt.actor ?? '?').slice(0, 1).toUpperCase())}</span>
  <span class="note-body"><span class="note-text">${esc(nt.text)}</span><span class="muted">${esc(KINDS[nt.kind]?.[0] ?? nt.kind)} · ${ago(nt.created_at)}</span></span></a>`;

export function mountNotifications(app, { db, page, notifier }) {
  const rows = (userId, { unreadOnly = false, limit = 50 } = {}) => db.prepare(
    `SELECT n.*, u.username actor FROM notifications n LEFT JOIN users u ON u.id = n.actor_id WHERE n.user_id = ? ${unreadOnly ? 'AND n.read_at IS NULL' : ''} ORDER BY n.id DESC LIMIT ?`).all(userId, limit);

  app.get('/notifications/menu', (req, res) => {
    const list = rows(req.user.id, { limit: 8 });
    res.type('html').send(`<div class="bell-head"><b>Notifications</b><form method="post" action="/notifications/read-all"><input type="hidden" name="back" value="/"><button class="link-btn">Mark all as read</button></form></div>
      <div class="bell-list">${list.map(item).join('') || '<p class="muted pad">You are all caught up.</p>'}</div>
      <div class="bell-foot"><a href="/notifications">View all</a><a href="/settings/notifications">Settings</a><button type="button" class="link-btn" id="desktop-alerts">Enable desktop alerts</button></div>`);
  });
  app.get('/notifications/count', (req, res) => {
    const latest = rows(req.user.id, { unreadOnly: true, limit: 1 })[0];
    res.json({ count: unreadCount(db, req.user.id), latest: latest ? { id: latest.id, text: latest.text, url: `/notifications/${latest.id}/go` } : null });
  });
  app.get('/notifications', (req, res) => {
    const unreadOnly = req.query.filter === 'unread';
    const list = rows(req.user.id, { unreadOnly });
    page(res, {
      title: 'Notifications', user: req.user, toc: false,
      body: `<div class="page-head"><div><span class="eyebrow">Inbox</span><h1 class="page-title">Notifications</h1></div>
          <div class="actions"><a class="btn ghost" href="/settings/notifications">${icon('settings')}Settings</a><form method="post" action="/notifications/read-all"><input type="hidden" name="back" value="/notifications"><button class="ghost">Mark all as read</button></form></div></div>
        <div class="tabs"><a class="tab${unreadOnly ? '' : ' on'}" href="/notifications">All</a><a class="tab${unreadOnly ? ' on' : ''}" href="/notifications?filter=unread">Unread</a></div>
        <div class="note-page">${list.map(item).join('') || `<div class="empty">${icon('bell')}<h3>${unreadOnly ? 'Nothing unread' : 'No notifications yet'}</h3><p>You will see new pages, new issues, assignments, comments and mentions here.</p></div>`}</div>`,
    });
  });
  app.post('/notifications/read-all', (req, res) => {
    db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
    const back = String(req.body.back ?? '/');
    res.redirect(/^\/[^/\\]/.test(back) || back === '/' ? back : '/');
  });
  app.get('/notifications/:id(\\d+)/go', (req, res) => {
    const nt = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!nt) return res.redirect('/notifications');
    db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ?').run(nt.id);
    res.redirect(nt.url.startsWith('/') ? nt.url : '/notifications');
  });

  app.get('/settings/notifications', (req, res) => {
    const on = (k) => (db.prepare('SELECT value FROM user_flags WHERE user_id = ? AND key = ?').get(req.user.id, `pref:${k}`)?.value ?? '1') === '1';
    page(res, {
      title: 'Notification settings', user: req.user, toc: false,
      body: `<span class="eyebrow">Settings</span><h1 class="page-title">Notification settings</h1>
        <p class="muted">Choose what appears in your bell. These settings only affect you.</p>
        <form class="prefs" method="post" action="/settings/notifications">
          ${Object.entries(KINDS).map(([k, [name, desc]]) => `<label class="pref"><input type="checkbox" name="${k}" value="1"${on(k) ? ' checked' : ''}><span><b>${esc(name)}</b><span class="muted">${esc(desc)}</span></span></label>`).join('')}
          <div class="actions"><button>Save settings</button><button type="button" class="ghost" id="desktop-alerts">Enable desktop alerts</button></div>
        </form>
        <p class="muted">You automatically watch pages and issues you create, edit, comment on or are assigned. Use <b>Watch</b> on any page or issue to change that.</p>`,
    });
  });
  app.post('/settings/notifications', (req, res) => {
    const set = db.prepare("INSERT INTO user_flags (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, at = CURRENT_TIMESTAMP");
    for (const k of Object.keys(KINDS)) set.run(req.user.id, `pref:${k}`, req.body[k] ? '1' : '0');
    res.redirect('/settings/notifications?saved=1');
  });

  app.post('/watch/:kind(issue|page)/:id(\\d+)', (req, res) => {
    const kind = req.params.kind, id = Number(req.params.id);
    const exists = kind === 'issue' ? db.prepare('SELECT 1 FROM issues WHERE id = ?').get(id) : db.prepare('SELECT 1 FROM pages WHERE id = ?').get(id);
    if (!exists) return res.status(404).send('Not found');
    notifier.isWatching(req.user.id, kind, id) ? notifier.unwatch(req.user.id, kind, id) : notifier.watch(req.user.id, kind, id);
    res.redirect(kind === 'issue' ? `/i/${id}` : `/p/${id}`);
  });
}

export const watchButton = (notifier, user, kind, id) => {
  const w = notifier.isWatching(user.id, kind, id);
  return `<form method="post" action="/watch/${kind}/${id}"><button class="ghost${w ? ' on' : ''}" aria-pressed="${w}" title="${w ? 'Stop getting updates' : 'Get updates about this'}">${icon('eye')}${w ? 'Watching' : 'Watch'}<span class="count">${notifier.watcherCount(kind, id)}</span></button></form>`;
};
