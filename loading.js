// ════════════════════════════════════════════
//  Hellowee Loading Modal
//  서버 콜드 스타트 로딩 표시
// ════════════════════════════════════════════

const loadingModal = document.getElementById('loadingModal');
const loadingText = document.getElementById('loadingText');
const loadingSub = document.getElementById('loadingSub');
let loadingTimeout = null;

function showLoading(text, sub) {
  if (loadingText) loadingText.textContent = text || '서버 연결 중...';
  if (loadingSub) loadingSub.innerHTML = sub || '첫 접속 시 서버가 깨어나는 데<br>최대 1분 정도 걸릴 수 있어요 🐾';
  if (loadingModal) loadingModal.classList.add('visible');

  // 90초 타임아웃 (연결 실패 대비)
  clearTimeout(loadingTimeout);
  loadingTimeout = setTimeout(() => {
    hideLoading();
    if (typeof lobbyError !== 'undefined' && lobbyError) {
      lobbyError.textContent = '서버 연결에 실패했어요. 다시 시도해주세요!';
    }
  }, 90000);
}

function hideLoading() {
  if (loadingModal) loadingModal.classList.remove('visible');
  clearTimeout(loadingTimeout);
}

// ─── renderer.js의 기존 함수들을 오버라이드 ───

// 방 만들기 버튼에 로딩 추가
const _origLobbyCreate = document.getElementById('lobbyCreate');
if (_origLobbyCreate) {
  const origHandler = _origLobbyCreate.onclick;
  _origLobbyCreate.addEventListener('click', () => {
    showLoading('방 만드는 중...', '서버에 연결하고 있어요<br>잠시만 기다려주세요 🐾');
  }, true); // capture phase로 먼저 실행
}

// 방 입장 버튼에 로딩 추가
const _origLobbyJoin = document.getElementById('lobbyJoin');
if (_origLobbyJoin) {
  _origLobbyJoin.addEventListener('click', () => {
    const code = document.getElementById('lobbyCode')?.value?.trim();
    const roomName = document.getElementById('lobbyJoinRoomName')?.value?.trim();
    if (code && roomName) {
      showLoading('방에 입장하는 중...', '서버에 연결하고 있어요<br>잠시만 기다려주세요 🐾');
    }
  }, true);
}

// Socket 연결 성공 시 로딩 숨기기 (전역 훅)
const _origConnectSocket = typeof connectSocket === 'function' ? connectSocket : null;
if (typeof window !== 'undefined') {
  // socket 이벤트로 로딩 해제
  document.addEventListener('hellowee-connected', () => hideLoading());
  document.addEventListener('hellowee-error', (e) => {
    hideLoading();
    const lobbyErr = document.getElementById('lobbyError');
    if (lobbyErr && e.detail) lobbyErr.textContent = e.detail;
  });
}

module.exports = { showLoading, hideLoading };
