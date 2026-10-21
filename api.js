/* ==========================================================================
   api.js — تنها نقطه‌ی ارتباط سایت با داده‌ها و حساب کاربری

   حالت 'local'  : همه‌چیز فقط روی همین مرورگر ذخیره می‌شه (localStorage).
                   برای ساخت و تست رابط کاربری خوبه، ولی مخصوص همین مرورگره
                   و بازدیدکننده‌های دیگه تغییرات رو نمی‌بینن.
   حالت 'remote' : وصل به سرور واقعی. قرارداد آدرس‌ها پایین همین فایل هست.

   بعد از گرفتن سرور فقط این خط رو قبل از api.js تو index.html و account.html بذار:
     <script>window.DM_CONFIG = { mode: 'remote', baseUrl: 'https://api.example.com' };</script>

   مهم برای امنیت: چک «مدیر بودن» اینجا فقط برای راحتی رابط کاربریه.
   تو سرور واقعی هر درخواست نوشتن (POST/PUT/DELETE) باید سمت سرور هم
   بررسی بشه که کاربر مدیره.
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = Object.assign({ mode: 'local', baseUrl: '' }, window.DM_CONFIG || {});
  var NS = 'dm:v1:';

  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  var HTTP_RE = /^https?:\/\/\S+$/i;
  var IMG_RE = /^(data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https?:\/\/\S+|\/\S+)$/i;

  /* ----------------------------- حالت local ----------------------------- */
  var local = (function () {
    function read(k, d) {
      try { var v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    }
    function write(k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { throw fail('storage_full'); }
    }

    async function hash(salt, pass) {
      var data = new TextEncoder().encode(salt + ':' + pass);
      if (window.crypto && crypto.subtle) {
        var buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
      var h = 2166136261; // اگه مرورگر crypto.subtle نداشت (آدرس غیرامن)
      data.forEach(function (b) { h ^= b; h = Math.imul(h, 16777619); });
      return 'f' + (h >>> 0).toString(16);
    }
    function pub(u) { return { id: u.id, name: u.name, email: u.email, role: u.role }; }
    function currentUser() {
      var s = read('session', null);
      if (!s) return null;
      return read('users', []).find(function (u) { return u.id === s.id; }) || null;
    }
    function needAdmin() {
      var u = currentUser();
      if (!u || u.role !== 'admin') throw fail('forbidden');
      return u;
    }

    var auth = {
      async me() { var u = currentUser(); return u ? pub(u) : null; },
      // اولین حساب ساخته‌شده مدیر سایت می‌شه
      async firstUser() { return read('users', []).length === 0; },
      async register(d) {
        var name = String(d.name || '').trim();
        var email = String(d.email || '').trim().toLowerCase();
        var pass = String(d.password || '');
        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || pass.length < 8) throw fail('invalid');
        var users = read('users', []);
        if (users.some(function (u) { return u.email === email; })) throw fail('email_taken');
        var salt = uid() + uid();
        var user = {
          id: uid(), name: name, email: email, salt: salt, passHash: await hash(salt, pass),
          role: users.length === 0 ? 'admin' : 'user', createdAt: Date.now()
        };
        users.push(user);
        write('users', users);
        write('session', { id: user.id });
        return pub(user);
      },
      async login(d) {
        var email = String(d.email || '').trim().toLowerCase();
        var u = read('users', []).find(function (x) { return x.email === email; });
        if (!u || (await hash(u.salt, String(d.password || ''))) !== u.passHash) throw fail('bad_credentials');
        write('session', { id: u.id });
        return pub(u);
      },
      async logout() { try { localStorage.removeItem(NS + 'session'); } catch (e) { /* مهم نیست */ } }
    };

    // ---------- محتوا ----------
    function seedItems() {
      if (read('seeded', false)) return;
      var t = Date.now();
      function mk(id, cat, i) {
        return { id: 'seed-' + id, cat: cat, title: 'عنوان نمونه', desc: '', year: '', cover: '', link: '', file: null,
                 fresh: true, createdAt: t - i * 1000, updatedAt: t - i * 1000 };
      }
      write('items', [mk('film', 'movies', 0), mk('anime', 'anime', 1), mk('game', 'games', 2), mk('music', 'music', 3), mk('series', 'series', 4)]);
      write('seeded', true);
    }
    var CATS = ['movies', 'series', 'animations', 'anime', 'games', 'music', 'apps'];
    function cleanItem(it) {
      var title = String(it.title || '').trim().slice(0, 120);
      if (!title || CATS.indexOf(it.cat) < 0) throw fail('invalid');
      var year = String(it.year || '').trim();
      if (!/^\d{0,4}$/.test(year)) throw fail('invalid');
      var link = String(it.link || '').trim();
      if (link && !HTTP_RE.test(link)) throw fail('invalid');
      var cover = String(it.cover || '');
      if (cover && !IMG_RE.test(cover)) throw fail('invalid');
      var file = null;
      if (it.file && it.file.name) {
        file = { name: String(it.file.name).slice(0, 200), size: Number(it.file.size) || 0,
                 url: it.file.url && /^(https?:\/\/|\/)\S+$/i.test(it.file.url) ? it.file.url : null,
                 pending: !!it.file.pending };
      }
      return { cat: it.cat, title: title, desc: String(it.desc || '').trim().slice(0, 2000), year: year,
               cover: cover, link: link, file: file, fresh: !!it.fresh };
    }
    var items = {
      async list(q) {
        q = q || {};
        seedItems();
        var a = read('items', []);
        if (q.cat) a = a.filter(function (i) { return i.cat === q.cat; });
        if (q.fresh) a = a.filter(function (i) { return i.fresh; });
        return a.sort(function (x, y) { return y.createdAt - x.createdAt; });
      },
      async save(it) {
        needAdmin();
        seedItems();
        var all = read('items', []), now = Date.now(), out;
        var c = cleanItem(it);
        if (it.id) {
          var idx = all.findIndex(function (x) { return x.id === it.id; });
          if (idx < 0) throw fail('notfound');
          out = Object.assign({}, all[idx], c, { updatedAt: now });
          all[idx] = out;
        } else {
          out = Object.assign({ id: uid(), createdAt: now, updatedAt: now }, c);
          all.push(out);
        }
        write('items', all);
        return out;
      },
      async remove(id) {
        needAdmin();
        write('items', read('items', []).filter(function (x) { return x.id !== id; }));
      }
    };

    // ---------- متن‌های سایت ----------
    var DEFAULT_SITE = {
      heroSub: 'فیلم، سریال، انیمیشن، انیمه، بازی، موزیک و برنامه، همه توی یه جا.',
      about: 'اینجا یه معرفی کوتاه از خودت بنویس: کی هستی و این سایت رو برای چی ساختی. دو سه جمله کافیه.',
      email: 'you@example.com', telegram: '', instagram: ''
    };
    function cleanSite(p) {
      var o = {};
      ['heroSub', 'about'].forEach(function (k) { if (k in p) o[k] = String(p[k] || '').trim().slice(0, 1000); });
      if ('email' in p) {
        var e = String(p.email || '').trim();
        if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw fail('invalid');
        o.email = e;
      }
      ['telegram', 'instagram'].forEach(function (k) {
        if (k in p) {
          var v = String(p[k] || '').trim();
          if (v && !HTTP_RE.test(v)) throw fail('invalid');
          o[k] = v;
        }
      });
      return o;
    }
    var site = {
      async get() { return Object.assign({}, DEFAULT_SITE, read('site', {})); },
      async save(patch) {
        needAdmin();
        var s = Object.assign({}, await site.get(), cleanSite(patch));
        write('site', s);
        return s;
      }
    };

    // ---------- آپلود ----------
    function compress(file, max, q) {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
          var r = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * r));
          c.height = Math.max(1, Math.round(img.height * r));
          var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          res(c.toDataURL('image/jpeg', q));
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(fail('bad_image')); };
        img.src = url;
      });
    }
    var media = {
      // عکس کاور کوچیک و ذخیره می‌شه. فایل‌های دیگه (بازی، فیلم و...) تو حالت local
      // فقط اسم و حجمشون ثبت می‌شه و بعد از وصل شدن به سرور واقعی آپلود می‌شن.
      async upload(file, o) {
        needAdmin();
        if (o && o.kind === 'image') {
          return { url: await compress(file, 720, 0.8), name: file.name, size: file.size };
        }
        return { url: null, name: file.name, size: file.size, pending: true };
      }
    };

    // ---------- پشتیبان‌گیری (فقط حالت local) ----------
    var data = {
      async exportAll() {
        needAdmin();
        seedItems();
        return { version: 1, exportedAt: new Date().toISOString(), items: read('items', []), site: await site.get() };
      },
      async importAll(obj) {
        needAdmin();
        if (!obj || !Array.isArray(obj.items)) throw fail('invalid');
        var now = Date.now();
        var clean = obj.items.map(function (it, i) {
          var c = cleanItem(it);
          return Object.assign({ id: String(it.id || uid()), createdAt: Number(it.createdAt) || now - i, updatedAt: Number(it.updatedAt) || now }, c);
        });
        write('items', clean);
        write('seeded', true);
        if (obj.site) write('site', Object.assign({}, DEFAULT_SITE, cleanSite(obj.site)));
      }
    };

    return { mode: 'local', auth: auth, items: items, site: site, media: media, data: data };
  })();

  /* ----------------------------- حالت remote -----------------------------
     قرارداد سرور (همه JSON، کوکی نشست با credentials: 'include'):
       GET    /api/auth/me                 -> { user: {id,name,email,role} | null }
       POST   /api/auth/register {name,email,password} -> { user }   خطا: { error: 'email_taken' | 'invalid' }
       POST   /api/auth/login    {email,password}      -> { user }   خطا: { error: 'bad_credentials' }
       POST   /api/auth/logout                          -> {}
       GET    /api/items?cat=movies&fresh=1             -> { items: [Item] }
       POST   /api/items          Item(بدون id)         -> { item }   فقط مدیر
       PUT    /api/items/:id      Item                  -> { item }   فقط مدیر
       DELETE /api/items/:id                            -> {}         فقط مدیر
       GET    /api/site                                 -> { site: {heroSub,about,email,telegram,instagram} }
       PUT    /api/site           {…بخشی از فیلدها}     -> { site }   فقط مدیر
       POST   /api/upload  (multipart: file, kind)      -> { url, name, size }   فقط مدیر
     Item = { id, cat, title, desc, year, cover(url), link, file:{name,size,url}|null, fresh, createdAt, updatedAt }
     دسته‌ها: movies series animations anime games music apps
     ---------------------------------------------------------------------- */
  var remote = (function () {
    var base = String(CONFIG.baseUrl || '').replace(/\/$/, '');
    async function req(method, path, body, isForm) {
      var opt = { method: method, credentials: 'include', headers: {} };
      if (body) {
        if (isForm) opt.body = body;
        else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
      }
      var r = await fetch(base + path, opt), j = null;
      try { j = await r.json(); } catch (e) { /* بدنه خالی */ }
      if (!r.ok) throw fail((j && j.error) || ('http_' + r.status));
      return j || {};
    }
    return {
      mode: 'remote',
      auth: {
        async me() { return (await req('GET', '/api/auth/me')).user || null; },
        async firstUser() { return false; },
        async register(d) { return (await req('POST', '/api/auth/register', d)).user; },
        async login(d) { return (await req('POST', '/api/auth/login', d)).user; },
        async logout() { await req('POST', '/api/auth/logout'); }
      },
      items: {
        async list(q) {
          q = q || {};
          var p = new URLSearchParams();
          if (q.cat) p.set('cat', q.cat);
          if (q.fresh) p.set('fresh', '1');
          return (await req('GET', '/api/items' + (p.toString() ? '?' + p : ''))).items || [];
        },
        async save(it) {
          var r = it.id ? await req('PUT', '/api/items/' + encodeURIComponent(it.id), it) : await req('POST', '/api/items', it);
          return r.item;
        },
        async remove(id) { await req('DELETE', '/api/items/' + encodeURIComponent(id)); }
      },
      site: {
        async get() { return (await req('GET', '/api/site')).site; },
        async save(p) { return (await req('PUT', '/api/site', p)).site; }
      },
      media: {
        async upload(file, o) {
          var f = new FormData();
          f.append('file', file);
          f.append('kind', (o && o.kind) || 'file');
          return await req('POST', '/api/upload', f, true);
        }
      },
      data: null
    };
  })();

  window.Api = CONFIG.mode === 'remote' ? remote : local;
})();
