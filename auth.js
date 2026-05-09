// ════════════════════════════════════════════
//  Hellowee Auth (Supabase + electron-store)
//  소셜 로그인 + 자동 로그인 + 약관 동의
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const Store = require('electron-store');

// Supabase 설정 (munyang_lab 프로젝트)
const SUPABASE_URL = 'https://wvyiaozmuiwrsrbwvrjp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2eWlhb3ptdWl3cnNyYnd2cmpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MjgzNTAsImV4cCI6MjA5MzMwNDM1MH0.ZfZ3NGbCQHgMBeMH4PXEoNGRoeKkZ_peF6KNx_jxgBY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 로컬 저장소 (electron-store)
const store = new Store({
  name: 'hellowee-auth',
  encryptionKey: 'hellowee-secure-2026',
  defaults: {
    session: null,
    nickname: null,
    termsAccepted: false,
    lastRoom: null,
    parts: null,
  },
});

class Auth {
  constructor() {
    this.user = null;
    this.profile = null;
  }

  async tryAutoLogin() {
    const savedSession = store.get('session');
    if (!savedSession?.refresh_token) return null;
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: savedSession.access_token,
        refresh_token: savedSession.refresh_token,
      });
      if (error) { store.delete('session'); return null; }
      this.user = data.user;
      this.saveSession(data.session);
      await this.loadProfile();
      return this.user;
    } catch (e) { return null; }
  }

  async loginWithProvider(provider) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: 'hellowee://auth/callback', skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };
    return { url: data.url };
  }

  async handleAuthCallback(url) {
    const hashParams = new URLSearchParams(url.split('#')[1] || '');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (!accessToken || !refreshToken) return { error: '인증 정보를 찾을 수 없어요' };
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return { error: error.message };
    this.user = data.user;
    this.saveSession(data.session);
    await this.loadProfile();
    return { user: this.user };
  }

  async loadProfile() {
    if (!this.user) return null;
    const { data } = await supabase.from('hellowee_profiles').select('*').eq('id', this.user.id).single();
    if (data) { this.profile = data; store.set('nickname', data.nickname); if (data.parts) store.set('parts', data.parts); }
    return this.profile;
  }

  async updateNickname(nickname) {
    if (!this.user) return;
    await supabase.from('hellowee_profiles').update({ nickname, updated_at: new Date().toISOString() }).eq('id', this.user.id);
    store.set('nickname', nickname);
    if (this.profile) this.profile.nickname = nickname;
  }

  async updateParts(parts) {
    if (!this.user) return;
    await supabase.from('hellowee_profiles').update({ parts, updated_at: new Date().toISOString() }).eq('id', this.user.id);
    store.set('parts', parts);
    if (this.profile) this.profile.parts = parts;
  }

  saveSession(session) {
    if (session) store.set('session', { access_token: session.access_token, refresh_token: session.refresh_token });
  }

  async logout() { await supabase.auth.signOut(); this.user = null; this.profile = null; store.delete('session'); }
  acceptTerms() { store.set('termsAccepted', true); }
  needsTerms() { return !store.get('termsAccepted'); }
  saveLastRoom(code, roomName) { store.set('lastRoom', { code, roomName }); }
  getLastRoom() { return store.get('lastRoom'); }
  getSavedNickname() { return store.get('nickname') || 'guest'; }
  getSavedParts() { return store.get('parts') || null; }
  isLoggedIn() { return !!this.user; }
}

module.exports = { Auth, supabase, store };
