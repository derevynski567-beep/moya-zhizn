(() => {
  const KEY = 'moya-zhizn-data';
  const config = window.MOYA_SUPABASE_CONFIG || {};
  const supa = window.supabase && config.url && config.key ? window.supabase.createClient(config.url, config.key) : null;
  if (!supa) return;
  let user = null, ready = false, busy = false, conflict = false, lastSaved = localStorage.getItem(KEY) || '', lastCloudUpdatedAt = null, lastCloudRaw = '', timer, pollTimer;
  const panel = document.createElement('section');
  panel.className = 'card';
  panel.style.cssText = 'max-width:1060px;margin:0 auto 18px;padding:16px 20px';
  panel.innerHTML = '<b>Облачная синхронизация</b><p class="muted small">Войди или создай аккаунт, чтобы синхронизировать данные между устройствами.</p><form id="cloud-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"><input id="cloud-email" type="email" placeholder="Электронная почта" autocomplete="email" required style="padding:10px;border:1px solid #ddd;border-radius:10px"><input id="cloud-password" type="password" placeholder="Пароль (от 6 символов)" minlength="6" autocomplete="current-password" required style="padding:10px;border:1px solid #ddd;border-radius:10px"><button class="btn" type="submit">Войти</button><button class="btn light" id="cloud-signup" type="button">Создать аккаунт</button><button class="btn ghost" id="cloud-test" type="button">Проверить соединение</button></form><div id="cloud-status" class="muted small" style="margin-top:8px">Локальные данные не изменены.</div><div id="cloud-controls" style="display:none;margin-top:8px"><button class="btn light" id="cloud-sync" type="button">Синхронизировать сейчас</button> <button class="btn light" id="cloud-pull" type="button" style="display:none">Загрузить версию из облака</button> <button class="btn light" id="cloud-push-local" type="button" style="display:none">Сохранить версию этого устройства</button> <button class="btn ghost" id="cloud-out" type="button">Выйти</button></div>';
  const root = document.querySelector('#root');
  // Keep the cloud controls outside #root: the app re-renders #root on every tab change.
  // Inserting the panel inside #root caused it to disappear as soon as render() ran.
  if (root && root.parentNode) root.parentNode.insertBefore(panel, root);
  const status = text => { const el = document.querySelector('#cloud-status'); if (el) el.textContent = text; };
  const controls = () => {
    document.querySelector('#cloud-form').style.display = user ? 'none' : 'grid';
    document.querySelector('#cloud-controls').style.display = user ? 'block' : 'none';
    if (user) status('Вход выполнен: ' + (user.email || 'аккаунт') + '. Проверяю облачную копию…');
  };
  async function push() {
    if (!user || !ready || busy || conflict) return;
    busy = true; status('Синхронизация…');
    try {
      const raw = localStorage.getItem(KEY) || '{}';
      const data = JSON.parse(raw);
      if (lastCloudUpdatedAt) {
        const remoteCheck = await supa.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
        if (remoteCheck.error) throw remoteCheck.error;
        const currentRemote = remoteCheck.data;
        if (currentRemote && currentRemote.updated_at && currentRemote.updated_at !== lastCloudUpdatedAt) {
          const remoteRaw = JSON.stringify(currentRemote.data);
          if (remoteRaw !== JSON.stringify(data)) {
            showConflict('Облако изменилось на другом устройстве. Выбери, какую версию сохранить. Пока выбор не сделан, автоматическая запись остановлена.');
            return;
          }
          lastCloudUpdatedAt = currentRemote.updated_at;
          lastCloudRaw = remoteRaw;
        }
      }
      const updatedAt = new Date().toISOString();
      const { error } = await supa.from('user_data').upsert({user_id:user.id,data,updated_at:updatedAt},{onConflict:'user_id'});
      if (error) throw error;
      lastSaved = raw;
      lastCloudRaw = JSON.stringify(data);
      lastCloudUpdatedAt = updatedAt;
      status('Синхронизировано · ' + new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) { status('Ошибка синхронизации: ' + e.message); }
    finally { busy = false; }
  }
  function showConflict(message) {
    conflict = true;
    status(message);
    const pull = document.querySelector('#cloud-pull');
    const pushLocal = document.querySelector('#cloud-push-local');
    if (pull) pull.style.display = 'inline-block';
    if (pushLocal) pushLocal.style.display = 'inline-block';
  }
  function clearConflict() {
    conflict = false;
    const pull = document.querySelector('#cloud-pull');
    const pushLocal = document.querySelector('#cloud-push-local');
    if (pull) pull.style.display = 'none';
    if (pushLocal) pushLocal.style.display = 'none';
  }
  async function pullCloudVersion() {
    if (!user || busy) return;
    if (!confirm('Загрузить облачную версию на это устройство? Текущие локальные данные будут сохранены в резервную копию браузера перед заменой.')) return;
    busy = true;
    try {
      const {data,error} = await supa.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
      if (error) throw error;
      if (!data || !data.data) throw new Error('В облаке нет сохранённой версии.');
      const localRaw = localStorage.getItem(KEY);
      if (localRaw) localStorage.setItem('moya-zhizn-before-cloud-restore', JSON.stringify({savedAt:new Date().toISOString(),data:JSON.parse(localRaw)}));
      const raw = JSON.stringify(data.data);
      localStorage.setItem(KEY, raw);
      lastSaved = raw; lastCloudRaw = raw; lastCloudUpdatedAt = data.updated_at || null;
      clearConflict(); ready = true;
      status('Облачная версия загружена. Обновляю приложение…');
      location.reload();
    } catch(e) { status('Не удалось загрузить облачную версию: ' + e.message); }
    finally { busy = false; }
  }
  async function pushLocalVersion() {
    if (!user || busy) return;
    if (!confirm('Заменить облачную версию данными этого устройства? Перед записью локальная копия будет сохранена в резервную копию браузера. Если в облаке есть новые записи, они могут быть заменены. Продолжить?')) return;
    busy = true;
    try {
      const raw = localStorage.getItem(KEY) || '{}';
      const localData = JSON.parse(raw);
      const remote = await supa.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
      if (remote.error) throw remote.error;
      if (remote.data && remote.data.data) {
        localStorage.setItem('moya-zhizn-before-cloud-restore', JSON.stringify({savedAt:new Date().toISOString(),data:localData}));
        localStorage.setItem('moya-zhizn-cloud-before-overwrite', JSON.stringify({savedAt:new Date().toISOString(),data:remote.data.data}));
      }
      const updatedAt = new Date().toISOString();
      const {error} = await supa.from('user_data').upsert({user_id:user.id,data:localData,updated_at:updatedAt},{onConflict:'user_id'});
      if (error) throw error;
      lastSaved = raw; lastCloudRaw = JSON.stringify(localData); lastCloudUpdatedAt = updatedAt;
      clearConflict(); ready = true;
      status('Данные этого устройства сохранены в облако · ' + new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) { showConflict('Не удалось разрешить конфликт: ' + e.message); }
    finally { busy = false; }
  }
  async function login(userObj) {
    user = userObj; controls(); ready = false;
    try {
      const {data,error} = await supa.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        lastCloudUpdatedAt = data.updated_at || null;
        lastCloudRaw = JSON.stringify(data.data);
        const localRaw = localStorage.getItem(KEY) || '{}';
        let cloudRaw = '';
        try { cloudRaw = JSON.stringify(data.data); } catch (_) {}
        let localComparable = '';
        try { localComparable = JSON.stringify(JSON.parse(localRaw)); } catch (_) {}
        if (cloudRaw && localComparable === cloudRaw) {
          ready = true;
          lastSaved = localRaw;
          status('Синхронизировано · облачные и локальные данные совпадают.');
          return;
        }
        if (!confirm('В облаке уже есть данные, и они отличаются от данных этого устройства. Перед заменой я сохраню текущую локальную копию в резервный снимок этого браузера. Нажми OK, чтобы загрузить данные из облака. Нажми Отмена, чтобы оставить локальные данные без изменений.')) {
          status('Синхронизация не включена. Локальные данные сохранены.'); return;
        }
        try {
          const localSnapshot = localStorage.getItem(KEY);
          if (localSnapshot) localStorage.setItem('moya-zhizn-before-cloud-restore', JSON.stringify({savedAt:new Date().toISOString(),data:JSON.parse(localSnapshot)}));
        } catch (backupError) {
          status('Не удалось создать резервную копию локальных данных. Облачная копия не загружена, локальные данные сохранены.');
          return;
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
  document.querySelector('#cloud-test').addEventListener('click', async () => {
    status('Проверяю соединение с Supabase Auth…');
    try {
      const response = await fetch(config.url.replace(/\/$/, '') + '/auth/v1/health', {
        method: 'GET',
        headers: { apikey: config.key }
      });
      const body = await response.text();
      status('Проверка соединения: HTTP ' + response.status + '. Ответ: ' + body.slice(0, 180));
      console.info('Supabase health check', response.status, body);
    } catch (e) {
      status('Сбой сетевого запроса к Supabase: ' + (e && e.message ? e.message : String(e)) + '. Возможны блокировка сети/CORS или недоступность endpoint.');
      console.error('Supabase health check failed', e);
    }
  });
  async function checkRemote() {
    if (!user || !ready || busy || !navigator.onLine) return;
    try {
      const {data,error} = await supa.from('user_data').select('data,updated_at').eq('user_id',user.id).maybeSingle();
      if (error) throw error;
      if (!data || !data.data || !data.updated_at || data.updated_at === lastCloudUpdatedAt) return;
      const remoteRaw = JSON.stringify(data.data);
      const localRaw = localStorage.getItem(KEY) || '{}';
      if (remoteRaw === JSON.stringify(JSON.parse(localRaw))) {
        lastCloudRaw = remoteRaw; lastCloudUpdatedAt = data.updated_at; lastSaved = localRaw;
        status('Уже актуально · обновление подтверждено облаком.');
        return;
      }
      if (localRaw === lastSaved) {
        try {
          localStorage.setItem('moya-zhizn-before-cloud-restore', JSON.stringify({savedAt:new Date().toISOString(),data:JSON.parse(localRaw)}));
        } catch (backupError) {
          status('Есть обновление на другом устройстве, но резервную копию создать не удалось. Локальные данные не менялись.');
          return;
        }
        localStorage.setItem(KEY, remoteRaw);
        lastSaved = localStorage.getItem(KEY) || '';
        lastCloudRaw = remoteRaw; lastCloudUpdatedAt = data.updated_at;
        status('Получено обновление с другого устройства. Обновляю экран…');
        location.reload();
        return;
      }
      showConflict('Изменения есть и на этом, и на другом устройстве. Ничего не перезаписано. Выбери облачную версию или версию этого устройства.');
    } catch (e) {
      status('Не удалось проверить обновления в облаке: ' + (e && e.message ? e.message : String(e)));
    }
  }
  document.querySelector('#cloud-sync').addEventListener('click', push);
  document.querySelector('#cloud-pull').addEventListener('click', pullCloudVersion);
  document.querySelector('#cloud-push-local').addEventListener('click', pushLocalVersion);
  document.querySelector('#cloud-out').addEventListener('click', async () => { await supa.auth.signOut(); user=null; ready=false; controls(); status('Вышел из аккаунта. Локальные данные сохранены.'); });
  supa.auth.getSession().then(({data,error}) => {
    if (error) { status('Не удалось восстановить сессию: ' + error.message); return; }
    if(data.session) login(data.session.user);
  }).catch(e => status('Не удалось восстановить сессию: ' + (e && e.message ? e.message : String(e))));
  supa.auth.onAuthStateChange((event,session) => {
    if(event==='SIGNED_OUT'){user=null;ready=false;controls();status('Вы вышли из аккаунта. Локальные данные сохранены.');}
  });
  window.addEventListener('online', () => { if (!user) status('Соединение восстановлено. Можно войти или создать аккаунт.'); });
  window.addEventListener('offline', () => status('Нет подключения к интернету. Локальные данные доступны; облачная синхронизация возобновится после подключения.'));
  if (!navigator.onLine) status('Нет подключения к интернету. Локальные данные доступны; облачная синхронизация возобновится после подключения.');
  setInterval(() => {
    const raw = localStorage.getItem(KEY) || '';
    if (user && ready && raw !== lastSaved) { clearTimeout(timer); timer=setTimeout(push,1500); }
  },1500);
  pollTimer = setInterval(checkRemote, 10000);
})();