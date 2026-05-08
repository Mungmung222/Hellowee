// ════════════════════════════════════════════
//  Hellowee Auth (Supabase + electron-store)
//  소셜 로그인 + 자동 로그인 + 약관 동의
// ════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const Store = require('electron-store');

// Supabase 설정 (munyang_lab 프로젝트)
// TODO: 실제 키로 교체
const SUPABASE_URL = 'https://wvyiaozmuiwrsrbwvrjp.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE'; // Supabase 대시보드에서 복사

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 로컬 저장소 (electron-store)
const store = new Store({
  name: 'hellowee-auth',
  encryptionKey: 'hellowee-secure-2026', // 간단한 암호화
  defaults: {
    session: null,           // Supabase 세션
    nickname: null,          // 닉네임
    termsAccepted: false,    // 약관 동의 여부
    lastRoom: null,          // 마지막 방 정보 { code, roomName }
    parts: null,             // 커스텀 파츠
  },
});

class Auth {
  constructor() {
    this.user = null;
    this.profile = null;
  }

  // ─── 자동 로그인 시도 ───
  async tryAutoLogin() {
    const savedSession = store.get('session');
    if (!savedSession?.refresh_token) return null;

    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: savedSession.access_token,
        refresh_token: savedSession.refresh_token,
      });

      if (error) {
        console.log('자동 로그인 실패, 다시 로그인 필요:', error.message);
        store.delete('session');
        return null;
      }

      this.user = data.user;
      this.saveSession(data.session);
      await this.loadProfile();
      return this.user;
    } catch (e) {
      console.error('자동 로그인 오류:', e);
      return null;
    }
  }

  // ─── 소셜 로그인 (OAuth) ───
  async loginWithProvider(provider) {
    // provider: 'google' | 'kakao' | 'naver'
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: 'hellowee://auth/callback', // Electron deep link
        skipBrowserRedirect: true, // Electron에서 직접 처리
      },
    });

    if (error) {
      console.error('로그인 오류:', error.message);
      return { error: error.message };
    }

    // OAuth URL 반환 → Electron에서 브라우저 열기
    return { url: data.url };
  }

  // ─── OAuth 콜백 처리 ───
  async handleAuthCallback(url) {
    // URL에서 토큰 추출
    const hashParams = new URLSearchParams(url.split('#')[1] || '');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (!accessToken || !refreshToken) {
      return { error: '인증 정보를 찾을 수 없어요' };
    }

    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) return { error: error.message };

    this.user = data.user;
    this.saveSession(data.session);
    await this.loadProfile();
    return { user: this.user };
  }

  // ─── 프로필 로드 ───
  async loadProfile() {
    if (!this.user) return null;

    const { data, error } = await supabase
      .from('hellowee_profiles')
      .select('*')
      .eq('id', this.user.id)
      .single();

    if (data) {
      this.profile = data;
      store.set('nickname', data.nickname);
      if (data.parts) store.set('parts', data.parts);
    }

    return this.profile;
  }

  // ─── 닉네임 업데이트 ───
  async updateNickname(nickname) {
    if (!this.user) return;
    await supabase
      .from('hellowee_profiles')
      .update({ nickname, updated_at: new Date().toISOString() })
      .eq('id', this.user.id);
    store.set('nickname', nickname);
    if (this.profile) this.profile.nickname = nickname;
  }

  // ─── 파츠 업데이트 ───
  async updateParts(parts) {
    if (!this.user) return;
    await supabase
      .from('hellowee_profiles')
      .update({ parts, updated_at: new Date().toISOString() })
      .eq('id', this.user.id);
    store.set('parts', parts);
    if (this.profile) this.profile.parts = parts;
  }

  // ─── 세션 저장 ───
  saveSession(session) {
    if (session) {
      store.set('session', {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
    }
  }

  // ─── 로그아웃 ───
  async logout() {
    await supabase.auth.signOut();
    this.user = null;
    this.profile = null;
    store.delete('session');
  }

  // ─── 약관 동의 ───
  acceptTerms() {
    store.set('termsAccepted', true);
  }

  needsTerms() {
    return !store.get('termsAccepted');
  }

  // ─── 마지막 방 저장/불러오기 ───
  saveLastRoom(code, roomName) {
    store.set('lastRoom', { code, roomName });
  }

  getLastRoom() {
    return store.get('lastRoom');
  }

  // ─── 저장된 닉네임/파츠 ───
  getSavedNickname() {
    return store.get('nickname') || 'guest';
  }

  getSavedParts() {
    return store.get('parts') || null;
  }

  // ─── 로그인 상태 ───
  isLoggedIn() {
    return !!this.user;
  }
}

module.exports = { Auth, supabase, store };
