(() => {
  const KEY = 'moya-zhizn-data';
  const config = window.MOYA_SUPABASE_CONFIG || {};
  const supa = window.supabase && config.url && config.key ? window.supabase.createClient(config.url, config.key) : null;
  if (!supa) return;
  let user = null, ready = false, busy = false, lastSaved = localStorage.getItem(KEY) || '', timer;
  const panel = document.createElement('section');
  panel.className = 'card';
  panel.style.cssText = 'max-width:1060px;margin:0 auto 18px;padding:16px 20px';
  panel.innerHTML = '<b>Облачная синхронизация</b><p class="muted small">Войди или создай аккаунт, чтобы синхронизировать данные между устройствами.</p><form id="cloud-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"><input id="cloud-email" type="email" placeholder="Электронная почта" autocomplete="email" required style="padding:10px;border:1px solid #ddd;border-radius:10px"><input id="cloud-password" type="password" placeholder="Пароль (от 6 символов)" minlength="6" autocomplete="current-password" required style="padding:10px;border:1px solid #ddd;border-radius:10px"><button class="btn" type="submit">Войти</button><button class="btn light" id="cloud-signup" type="button">Создать аккаунт</button></form><div id="cloud-status" class="muted small" style="margin-top:8px">Локальные данные не изменены.</div><div id="cloud-controls" style="display:none;margin-top:8px"><button class="btn light" id="cloud-sync" type="button">Синхронизировать сейчас</button> <button class="btn ghost" id="cloud-out" type="button">Выйти</button></div>';
  const root = document.querySelector('#root');
  if (root) root.insertBefore(panel, root.firstChild);
  const status = text => { const el = document.querySelector('#cloud-status'); if (el) el.textContent = text; };
  const controls = () => {
    document.querySelector('#cloud-form').style.display = user ? 'none' : 'grid';
    document.querySelector('#cloud-controls').style.display = user ? 'block' : 'none';
    if (user) status('Вход выполнен: ' + (user.email || 'аккаунт') + '. Проверяю облачную копию…');
  };
  async function push() {
    if (!user || !ready || busy) return;
    busy = true; status('Синхронизация…');
    try {
      const raw = localStorage.getItem(KEY) || '{}';
      const data = JSON.parse(raw);
      const { error } = await supa.from('user_data').upsert({user_id:user.id,data,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if (error) throw error;
      lastSaved = raw;
      status('Синхронизировано · ' + new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) { status('Ошибка синхронизации: ' + e.message); }
    finally { busy = false; }
  }
  async function login(userObj) {
    user = userObj; controls(); ready = false;
    try {
      const {data,error} = await supa.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        if (!confirm('В облаке уже есть данные. Нажми OK, чтобы загрузить их на это устройство (заменив локальную копию). Нажми Отмена, чтобы не менять данные и не включать синхронизацию.')) {
          status('Синхронизация не включена. Локальные данные сохранены.'); return;
        }
        localStorage.setItem(KEY, JSON.stringify(data.data));
        lastSaved = localStorage.getItem(KEY) || '';
        status('Облачная копия загружена. Обновляю приложение…');
        location.reload(); return;
      }
      if (!confirm('В облаке пока нет данных. Сохранить текущие данные этого устройства в облако?')) {
        status('Синхронизация не включена. Локальные данные сохранены.'); return;
      }
      ready = true; await push();
    } catch(e) { ready = false; status('Не удалось загрузить облачные данные: ' + e.message); }
  }
  document.querySelector('#cloud-form').addEventListener('submit', async e => {
    e.preventDefault(); status('Выполняю вход…');
    try {
      const {data,error} = await supa.auth.signInWithPassword({email:document.querySelector('#cloud-email').value.trim(),password:document.querySelector('#cloud-password').value});
      if (error) { status('Ошибка входа: ' + error.message); return; }
      await login(data.user);
    } catch (e) {
      status('Ошибка соединения с Supabase Auth: ' + (e && e.message ? e.message : String(e)) + '. URL: ' + config.url);
      console.error('Supabase signInWithPassword failed', e);
    }
  });
  document.querySelector('#cloud-signup').addEventListener('click', async () => {
    status('Создаю аккаунт…');
    try {
      const {data,error} = await supa.auth.signUp({email:document.querySelector('#cloud-email').value.trim(),password:document.querySelector('#cloud-password').value,options:{emailRedirectTo:location.origin+location.pathname}});
      if (error) { status('Ошибка регистрации: ' + error.message); return; }
      if (!data.session) { status('Проверь почту и подтверди адрес, затем войди.'); return; }
      await login(data.user);
    } catch (e) {
      status('Ошибка соединения с Supabase Auth: ' + (e && e.message ? e.message : String(e)) + '. URL: ' + config.url);
      console.error('Supabase signUp failed', e);
    }
  });
  document.querySelector('#cloud-sync').addEventListener('click', push);
  document.querySelector('#cloud-out').addEventListener('click', async () => { await supa.auth.signOut(); user=null; ready=false; controls(); status('Вышел из аккаунта. Локальные данные сохранены.'); });
  supa.auth.getSession().then(({data}) => { if(data.session) login(data.session.user); });
  supa.auth.onAuthStateChange((event,session) => { if(event==='SIGNED_OUT'){user=null;ready=false;controls();} });
  setInterval(() => {
    const raw = localStorage.getItem(KEY) || '';
    if (user && ready && raw !== lastSaved) { clearTimeout(timer); timer=setTimeout(push,1000); }
  },1500);
})();