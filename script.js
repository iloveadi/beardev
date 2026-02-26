// ==========================================
// 1. 구동 환경 초기화 (팝업 -> 전체 탭 전환)
// ==========================================
/* 
 익스텐션 팝업에서 실행될 경우, 팝업 바깥을 클릭하면 영상 녹화가 
 비정상 종료되는 현상을 막기 위해 탭(Tab)으로 강제 오픈합니다.
*/
if (window.innerWidth < 800) {
    if (chrome && chrome.tabs && chrome.runtime) {
        chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
        window.close();
    }
}

// ==========================================
// 2. 전역 변수 및 상태 관리
// ==========================================
let image = new Image();
let audioCtx;
let analyser;
let source;
let dest;
let fadeGainNode; // 볼륨 페이드 제어용 노드
let audioElement = new Audio();

let isRecording = false;
let recorder;
let chunks = [];
let animationId;
let particles = [];
const NUM_PARTICLES = 150; // 파티클 개수

// ==========================================
// 3. DOM 요소 바인딩
// ==========================================
const imageInput = document.getElementById('imageInput');
const titleInput = document.getElementById('titleInput');
const channelInput = document.getElementById('channelInput'); // 채널명 입력 필드
const audioInput = document.getElementById('audioInput');
const colorThemeSelect = document.getElementById('colorTheme');
const visualizerStyleSelect = document.getElementById('visualizerStyle'); // 비주얼라이저 스타일 선택
const ratioSelect = document.getElementById('ratioSelect'); // 영상 비율 선택
const fadeToggle = document.getElementById('fadeToggle');
const startBtn = document.getElementById('startBtn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const recDot = document.getElementById('recDot');
const idleOverlay = document.getElementById('idleOverlay');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// 모달 요소 바인딩
const changelogBtn = document.getElementById('changelogBtn');
const privacyBtn = document.getElementById('privacyBtn');
const changelogModal = document.getElementById('changelogModal');
const privacyModal = document.getElementById('privacyModal');
const closeChangelogBtn = document.getElementById('closeChangelogBtn');
const closePrivacyBtn = document.getElementById('closePrivacyBtn');

// ==========================================
// 3.5. 모달 이벤트 제어
// ==========================================
if (changelogBtn) {
    changelogBtn.addEventListener('click', () => {
        changelogModal.classList.remove('hidden');
    });
}
if (closeChangelogBtn) {
    closeChangelogBtn.addEventListener('click', () => {
        changelogModal.classList.add('hidden');
    });
}
if (privacyBtn) {
    privacyBtn.addEventListener('click', () => {
        privacyModal.classList.remove('hidden');
    });
}
if (closePrivacyBtn) {
    closePrivacyBtn.addEventListener('click', () => {
        privacyModal.classList.add('hidden');
    });
}

// 모달 바깥 영역 클릭시 닫기
window.addEventListener('click', (e) => {
    if (e.target === changelogModal) {
        changelogModal.classList.add('hidden');
    }
    if (e.target === privacyModal) {
        privacyModal.classList.add('hidden');
    }
});
// ==========================================
// 3.6 화면 비율 변경 이벤트 (1080x1920 vs 1920x1080)
// ==========================================
if (ratioSelect) {
    // 이전 선택된 값을 캐논으로 저장
    let previousRatio = ratioSelect.value;

    ratioSelect.addEventListener('change', (e) => {
        if (isRecording) {
            alert('녹화 및 렌더링 중에는 화면 비율을 변경할 수 없습니다.');
            // 값 강제 원상복구
            e.target.value = previousRatio;
            return;
        }

        const val = e.target.value;
        previousRatio = val; // 현재 정상 반영된 값을 저장
        const canvasContainer = document.getElementById('canvasContainer');
        const resolutionBadge = document.getElementById('resolutionBadge');

        if (val === '16:9') {
            canvas.width = 1920;
            canvas.height = 1080;
            if (canvasContainer) canvasContainer.style.aspectRatio = '16/9';
            if (resolutionBadge) resolutionBadge.innerText = '1920x1080';
        } else {
            // 기본값 9:16
            canvas.width = 1080;
            canvas.height = 1920;
            if (canvasContainer) canvasContainer.style.aspectRatio = '9/16';
            if (resolutionBadge) resolutionBadge.innerText = '1080x1920';
        }

        // 캔버스 사이즈가 바뀌었으므로 기존 업로드된 이미지가 있다면 다시 꽉 차게 그리기
        drawPreviewImage();
    });
}

// ==========================================
// 4. 업로드 파일 처리 이벤트
// ==========================================
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        image.src = url;
        image.onload = () => {
            updateIdleState();
            drawPreviewImage();
        };
    }
});

audioInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // 파일 업로드 시 파일명 확장자 제거 추출
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");

        // 사용자가 명시적으로 입력해둔 제목이 없다면 자동 채우기
        if (!titleInput.value.trim()) {
            titleInput.value = fileNameWithoutExt;
        }

        const url = URL.createObjectURL(file);
        audioElement.src = url;
        audioElement.load();
        updateIdleState();
    }
});

// 파일이 등록되면 블러 오버레이 페이드 아웃
function updateIdleState() {
    if (image.src || audioElement.src) {
        idleOverlay.classList.add('opacity-0');
    }
}

// 캔버스 사이즈(1080x1920)에 맞춰 이미지를 꽉 채워(Cover) 그리는 유틸리티
function drawPreviewImage() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image.src) return;

    // Scale-to-Cover 비율 계산
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const scaledWidth = image.width * scale;
    const scaledHeight = image.height * scale;
    const x = (canvas.width / 2) - (scaledWidth / 2);
    const y = (canvas.height / 2) - (scaledHeight / 2);

    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
}

// ==========================================
// 5. 비주얼라이저 & MediaRecorder 핵심 로직
// ==========================================
startBtn.addEventListener('click', async () => {
    if (isRecording) {
        // 이미 녹화 중이라면 강제 종료
        stopVisualizer();
        return;
    }

    if (!image.src || !audioElement.src) {
        alert('배경 이미지와 오디오 파일(MP3/WAV)을 모두 업로드해주세요!');
        return;
    }

    try {
        await startVisualizer();
    } catch (err) {
        console.error("Audio Processing Error:", err);
        alert('영상 렌더링 준비 중 오류가 발생했습니다. 브라우저 설정을 확인해주세요.');
    }
});

async function startVisualizer() {
    // 5.1 오디오 컨텍스트 및 노드 초기화 설정 (Web Audio API)
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;               // 더 부드럽고 촘촘한 바를 위해 512로 증가 (256개 데이터 도출)
        analyser.smoothingTimeConstant = 0.8; // 주파수 움직임의 부드러움 정도

        fadeGainNode = audioCtx.createGain(); // 페이드용 노드 생성

        source = audioCtx.createMediaElementSource(audioElement);
        dest = audioCtx.createMediaStreamDestination(); // 캡처용 오디오 데스티네이션

        // 라우팅: 오디오 소스 -> 페이드 제어기 -> 분석기(비주얼라이저) -> 데스티네이션(녹화용) 및 스피커
        source.connect(fadeGainNode);
        fadeGainNode.connect(analyser);
        analyser.connect(dest);
        analyser.connect(audioCtx.destination);
    }

    // 오디오 컨텍스트가 멈춘 상태라면 재개
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    // 5.2. 캔버스 프레임 + 오디오 스트림 결합 (60fps 제한 설정)
    const canvasStream = canvas.captureStream(60);
    const audioStream = dest.stream;

    const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
    ]);

    // 5.3. 비디오 레코더 코덱 타입 지원여부 판단 (mp4 우선 지원)
    let mimeType = 'video/webm;codecs=vp9,opus'; // 안정성이 가장 뛰어난 기본 포맷
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
        mimeType = 'video/mp4;codecs=avc1';      // 가능하다면 네이티브 MP4 인코딩
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')) {
        mimeType = 'video/webm;codecs=h264,opus';
    }

    // 비디오 비트레이트를 높여 720p 화면 시인성 유지
    recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 10000000 // 10Mbps 수준 화질 확보
    });

    chunks = [];
    recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
        exportVideo(mimeType);
        resetUI();
    };

    // 5.4. 데이터 렌더링 및 재생 시작
    recorder.start(1000); // 메모리 초과를 방지하기 위해 1초 간격으로 Blob 객체 분할 저장
    audioElement.currentTime = 0;
    await audioElement.play();

    isRecording = true;
    recDot.classList.remove('hidden');

    // 파티클 초기화
    particles = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 3 + 1,
            speedY: Math.random() * 2 + 1,
            speedX: (Math.random() - 0.5) * 1.5,
            opacity: Math.random() * 0.4 + 0.1
        });
    }

    // 프레임 애니메이션 시작
    drawVisualizer();

    // UI 변경
    updateUIRecordingState();

    // 5.5 음악 재생이 완전히 종료되었을 시 자동 레코딩 종료
    audioElement.onended = () => {
        if (isRecording) stopVisualizer();
    };
}

// 시각화 작업 중지 (재생중단 & 레코딩 종결 처리)
function stopVisualizer() {
    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
    }
    audioElement.pause();
    isRecording = false;
    cancelAnimationFrame(animationId);
}

// 5.6. 메모리에 저장된 블롭 덩어리들을 결합하여 파일로 다운로드 내보내기 구현
function exportVideo(mimeType) {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    // 확장자를 현재 지원된 마임 타입에 맞추어 명시 지정
    let ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    a.href = url;

    // 타임스탬프를 포함하여 시그니처 네이밍 다운로드 
    // 사용자가 입력한 타이틀(기본: 음악파일명)이 있다면 우선 기반 네이밍 설계
    let finalTitle = titleInput.value.trim();
    if (finalTitle) {
        // 영문 제거 후 한글/숫자/공백/히이픈/언더스코어 정도만 남기기 (특수문자 제거)
        finalTitle = finalTitle.replace(/[a-zA-Z]/g, '').replace(/[^가-힣0-9\s_-]/g, '').trim();
    }
    const currentTitle = finalTitle ? finalTitle : `음악영상_${Date.now()}`;

    a.download = `${currentTitle}.${ext}`;

    document.body.appendChild(a);
    a.click();

    // 퍼포먼스를 위해 객체 URL 초기화 폐쇄 지연처리 적용
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ==========================================
// 6. 상태별 UI 처리 유틸리티 (테마 기반)
// ==========================================
function updateUIRecordingState() {
    startBtn.innerHTML = `
        <svg class="w-6 h-6 mr-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"></path></svg>
        작업 중지 및 영상 다운로드
    `;
    // 노란 버튼을 경고/중지의 붉은 버튼으로 전환
    startBtn.classList.remove('bg-accent', 'hover:bg-accent', 'text-black', 'shadow-glow', 'hover:shadow-glow');
    startBtn.classList.add('bg-red-600', 'hover:bg-red-500', 'text-white', 'shadow-[0_0_20px_rgba(220,38,38,0.4)]');

    // 프로그레스 바 활성화
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.innerText = '0%';
}

function resetUI() {
    recDot.classList.add('hidden');
    startBtn.innerHTML = `
        <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" fill-rule="evenodd"></path></svg>
        렌더링 및 녹화 시작
    `;
    // 오리지널 테마 색상으로 원복
    startBtn.classList.add('bg-accent', 'hover:bg-accent', 'text-black', 'shadow-glow', 'hover:shadow-glow');
    startBtn.classList.remove('bg-red-600', 'hover:bg-red-500', 'text-white', 'shadow-[0_0_20px_rgba(220,38,38,0.4)]');
    drawPreviewImage(); // 깔끔하게 이미지 재렌더링

    // 프로그레스 바 숨김
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.innerText = '0%';
}

// ==========================================
// 7. 실시간 비주얼라이저 드로잉 엔진 (RequestAnimationFrame)
// ==========================================
function drawVisualizer() {
    if (!isRecording) return;
    animationId = requestAnimationFrame(drawVisualizer);

    // 프로그레스 바 시각적 업데이트
    if (audioElement.duration) {
        // 백분율 계산 후 100%를 초과하지 않도록 제한
        const progress = Math.min((audioElement.currentTime / audioElement.duration) * 100, 100);
        progressBar.style.width = `${progress}%`;
        progressText.innerText = `${Math.floor(progress)}%`;
    }

    // 오디오 데이터 분석값 도출 (최대 배열 사이즈 = fftSize / 2 = 256)
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // 7.0 페이드 인/아웃 실시간 오디오 볼륨 처리
    if (fadeToggle && fadeToggle.checked && fadeGainNode && audioElement.duration) {
        const ct = audioElement.currentTime;
        const dur = audioElement.duration;
        let targetVol = 1.0;

        // 시작과 끝 3초 동안 볼륨을 서서히 조절 (페이드 인/아웃)
        const fadeTime = 3.0;
        if (ct < fadeTime) {
            targetVol = ct / fadeTime;
        } else if (ct > dur - fadeTime) {
            targetVol = Math.max(0, (dur - ct) / fadeTime);
        }

        // 0.1초 시정수로 부드럽게 볼륨 변경값 반영
        fadeGainNode.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.1);
    } else if (fadeGainNode) {
        fadeGainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.1);
    }

    // 7.1. 배경 영역 매 프레임 재복원 및 클리어 작업 수행
    drawPreviewImage();

    // 7.2. 밝은 이미지 위에서도 시각화 바가 선명하게 보이도록 어두운 틴트(Tint) 오버레이 삽입
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 선택된 네온 컬러 테마 적용
    const neonColors = {
        yellow: { baseHue: 50, shadow: 'rgba(250, 204, 21, 0.8)', bright: '#facc15', dim: 'rgba(250, 204, 21, 0.5)' },
        pink: { baseHue: 320, shadow: 'rgba(217, 70, 239, 0.8)', bright: '#d946ef', dim: 'rgba(217, 70, 239, 0.5)' },
        blue: { baseHue: 195, shadow: 'rgba(56, 189, 248, 0.8)', bright: '#38bdf8', dim: 'rgba(56, 189, 248, 0.5)' },
        green: { baseHue: 140, shadow: 'rgba(74, 222, 128, 0.8)', bright: '#4ade80', dim: 'rgba(74, 222, 128, 0.5)' },
        purple: { baseHue: 270, shadow: 'rgba(168, 85, 247, 0.8)', bright: '#a855f7', dim: 'rgba(168, 85, 247, 0.5)' },
        red: { baseHue: 350, shadow: 'rgba(239, 68, 68, 0.8)', bright: '#ef4444', dim: 'rgba(239, 68, 68, 0.5)' },
        cyan: { baseHue: 180, shadow: 'rgba(34, 211, 238, 0.8)', bright: '#22d3ee', dim: 'rgba(34, 211, 238, 0.5)' },
        orange: { baseHue: 25, shadow: 'rgba(249, 115, 22, 0.8)', bright: '#f97316', dim: 'rgba(249, 115, 22, 0.5)' },
        indigo: { baseHue: 250, shadow: 'rgba(99, 102, 241, 0.8)', bright: '#6366f1', dim: 'rgba(99, 102, 241, 0.5)' },
        lime: { baseHue: 85, shadow: 'rgba(132, 204, 22, 0.8)', bright: '#84cc16', dim: 'rgba(132, 204, 22, 0.5)' }
    };
    const theme = neonColors[colorThemeSelect.value] || neonColors.yellow;

    // 7.2.1. 파티클 효과 그리기 (오디오 볼륨 반응형)
    let avgVolume = 0;
    for (let i = 0; i < bufferLength; i++) {
        avgVolume += dataArray[i];
    }
    avgVolume = avgVolume / bufferLength;
    const volumeBoost = avgVolume / 128; // 평균 0 ~ 1.5 수준

    ctx.save();
    ctx.fillStyle = theme.bright;
    ctx.shadowColor = theme.shadow;
    ctx.shadowBlur = 10;

    particles.forEach(p => {
        // 소리가 클수록 파티클이 더 빠르게 위로 솟구침
        p.y -= p.speedY * (1 + volumeBoost * 0.8);
        p.x += p.speedX;

        // 화면 위로 벗어나면 하단에서 재설정
        if (p.y < 0) {
            p.y = canvas.height;
            p.x = Math.random() * canvas.width;
        }
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;

        ctx.beginPath();
        // 소리가 크면 더 밝아지고 커짐
        ctx.globalAlpha = Math.min(p.opacity + (volumeBoost * 0.3), 1);
        const currentSize = p.size * (1 + volumeBoost * 0.4);
        ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();

    // 7.2.5. 영상 타이틀 및 채널명 렌더링
    const titleText = titleInput.value.trim();
    // 사용자가 입력한 채널명이 없으면 빈 문자열 처리
    const channelName = channelInput && channelInput.value ? channelInput.value.trim() : "";

    // 스타일 및 레이아웃 변수 설정
    const style = visualizerStyleSelect.value;
    ctx.save(); // 기본 컨텍스트 상태 저장 (그림자, 폰트 스타일 복구를 위함)
    ctx.textAlign = 'center';

    // 타이틀 레이아웃 고정 (상단 35% 지점)
    const channelY = canvas.height * 0.35;

    // 채널명이 있을 경우에만 배경 상자와 텍스트 렌더링
    if (channelName) {
        ctx.font = 'italic bold 40px sans-serif';
        ctx.letterSpacing = '10px'; // 글자 간격 설정 (지원 브라우저 기준)

        // 배경 박스를 그리기 위한 텍스트 폭 측정
        const textMetrics = ctx.measureText(channelName);
        const textWidth = textMetrics.width;
        const boxPaddingX = 30;
        const boxPaddingY = 15;

        // 텍스트 뒤에 깔리는 반투명 검은색 배경 박스 그리기
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        // 둥근 사각형 형태의 배경 (roundRect 지원 브라우저 대비 폴백 포함)
        if (ctx.roundRect) {
            ctx.roundRect(canvas.width / 2 - textWidth / 2 - boxPaddingX, channelY - 35 - boxPaddingY, textWidth + boxPaddingX * 2, 40 + boxPaddingY * 2, 10);
        } else {
            ctx.fillRect(canvas.width / 2 - textWidth / 2 - boxPaddingX, channelY - 35 - boxPaddingY, textWidth + boxPaddingX * 2, 40 + boxPaddingY * 2);
        }
        ctx.fill();

        // 텍스트 렌더링
        ctx.fillStyle = theme.bright; // 동적 테마 엑센트 컬러
        ctx.shadowColor = theme.shadow;
        ctx.shadowBlur = 20;
        ctx.fillText(channelName, canvas.width / 2, channelY);
    }

    // 사용자가 입력한 타이틀이 있다면 채널명 아래에 표시 (길면 두 줄 분리)
    if (titleText) {
        let mainTitle = titleText;
        let subTitle = "";

        // 1. 괄호로 구분된 부제 패턴 "한국어 (English)" 분리
        const parenMatch = titleText.match(/^(.*?)\s*(\(.*?\))\s*$/);
        if (parenMatch) {
            mainTitle = parenMatch[1].trim();
            subTitle = parenMatch[2].trim();
        } else {
            // 2. 괄호 없이 "한국어 English" 패턴 분리 (첫 영문 알파벳 등장 기준)
            const firstEngIndex = titleText.search(/[a-zA-Z]/);
            if (firstEngIndex > 0) {
                // 한글과 영어가 혼합되어 있는 경우 분리
                mainTitle = titleText.substring(0, firstEngIndex).trim();
                subTitle = titleText.substring(firstEngIndex).trim();
            }
        }

        // 메인 타이틀 렌더링 (크고 화려하게, 110px 아래)
        ctx.font = '900 80px "Helvetica Neue", Arial, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = theme.shadow;
        ctx.shadowBlur = 30;
        ctx.letterSpacing = '5px';
        ctx.fillText(mainTitle, canvas.width / 2, channelY + 110);

        // 서브 영문/부제 타이틀 렌더링 (작고 은은하게, 메인으로부터 70px 아래 배치)
        if (subTitle) {
            ctx.font = '700 45px "Helvetica Neue", Arial, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.shadowBlur = 15;
            ctx.letterSpacing = '2px';
            ctx.fillText(subTitle, canvas.width / 2, channelY + 180);
        }
    }

    // 7.2.6. 중앙 하단 고정 "Bear Dev." 워터마크 표시 (두가지 색상)
    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.shadowBlur = 10;
    ctx.letterSpacing = '1px';

    const bearText = "Bear ";
    const devText = "Dev.";

    // 전체 텍스트 너비를 계산하여 완벽한 중앙 시작점 추출
    const bearWidth = ctx.measureText(bearText).width;
    const devWidth = ctx.measureText(devText).width;
    const totalWidth = bearWidth + devWidth;

    // 화면 가운데에서 전체 너비의 절반만큼 왼쪽으로 이동한 지점이 시작점 X
    const waterMarkStartX = (canvas.width / 2) - (totalWidth / 2);
    // 화면 하단부 거의 끝 (96% 지점)
    const waterMarkY = canvas.height * 0.96;

    ctx.textAlign = 'left'; // 좌표 기준을 직접 계산해서 그리므로 왼쪽 정렬 기준점 사용

    // "Bear " 부분 (흰색)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(bearText, waterMarkStartX, waterMarkY);

    // "Dev." 부분 (테마 강조색)
    ctx.fillStyle = theme.bright;
    ctx.shadowColor = theme.shadow;
    ctx.fillText(devText, waterMarkStartX + bearWidth, waterMarkY);

    ctx.restore(); // 텍스트 렌더링용으로 변경된 옵션(그림자 등)을 비주얼라이저 그리기 전 초기화

    // 7.3. 주파수 바 그리기 (스타일별 분기)
    const renderLength = Math.floor(bufferLength * 0.45);

    // 공통 레이아웃 관련 변수 (스코프 해결)
    const visualizerBoxWidth = canvas.width;
    const startX = 0;
    const baseLineY = canvas.height * 0.85;

    if (style === 'circle') {
        // --- 7.3.C. 원형 스펙트럼 스타일 ---
        const centerX = canvas.width / 2;
        const centerY = canvas.height * 0.7; // 제목과 하단 프로그레스바 사이로 이동
        const radius = 180; // 크기 축소

        for (let i = 0; i < renderLength; i++) {
            const ratio = Math.pow(dataArray[i] / 255, 1.2);
            const barLen = ratio * 150;
            const angle = (i / renderLength) * Math.PI * 2;

            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;
            const x2 = centerX + Math.cos(angle) * (radius + barLen);
            const y2 = centerY + Math.sin(angle) * (radius + barLen);

            ctx.strokeStyle = `hsl(${theme.baseHue + ((i / renderLength) * 40)}, 100%, 65%)`;
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
    } else if (style === 'particles') {
        // --- 7.3.P. 네온 파티클 (Starfield) 스타일 ---
        // 기존 파티클 시스템을 활용하되, 비트에 따라 파동 효과 추가
        const midX = canvas.width / 2;
        const midY = canvas.height * 0.6;

        ctx.save();
        ctx.shadowBlur = 15 * volumeBoost;
        ctx.shadowColor = theme.shadow;
        for (let i = 0; i < renderLength; i += 2) {
            const ratio = (dataArray[i] / 255);
            const angle = (i / renderLength) * Math.PI * 2 + (Date.now() * 0.001);
            const dist = 200 + ratio * 400;

            ctx.fillStyle = `hsl(${theme.baseHue + ((i / renderLength) * 30)}, 100%, 75%)`;
            const x = midX + Math.cos(angle) * dist;
            const y = midY + Math.sin(angle) * dist;
            const size = 2 + ratio * 15;

            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    } else if (style === 'bars') {
        // --- 7.3.S. 부드러운 네온 막대 스타일 ---
        const barWidth = visualizerBoxWidth / renderLength;

        for (let i = 0; i < renderLength; i++) {
            const ratio = Math.pow(dataArray[i] / 255, 1.2);
            const h = ratio * 500;
            const x = i * barWidth;

            ctx.fillStyle = `hsl(${theme.baseHue + ((i / renderLength) * 40)}, 100%, 65%)`;
            ctx.fillRect(x, baseLineY - h, barWidth - 2, h);
        }
    } else {
        // --- 7.3.B. 분절된 레트로 블록 (Default) ---
        const barWidth = visualizerBoxWidth / renderLength;
        let x = startX;
        const blockHeight = 6;
        const blockGap = 4;
        const blockTotalHeight = blockHeight + blockGap;

        for (let i = 0; i < renderLength; i++) {
            const ratio = Math.pow(dataArray[i] / 255, 1.2);
            const maxBarHeight = canvas.height * 0.25;
            const targetHeight = Math.max(ratio * maxBarHeight, blockTotalHeight);
            const numBlocks = Math.floor(targetHeight / blockTotalHeight);
            const hue = theme.baseHue + ((i / renderLength) * 40 - 20);
            ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;

            for (let j = 0; j < numBlocks; j++) {
                const y = baseLineY - (j * blockTotalHeight) - blockHeight;
                ctx.fillRect(x, y, barWidth - 3, blockHeight);
            }
            x += barWidth;
        }
    }

    // 7.4. 비주얼라이저의 기준이 되는 하단 실선 (은은하게)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(startX, baseLineY, visualizerBoxWidth, 2);

    // 7.5. 영상(렌더링 화면) 내 노래 진행 프로그레스 바 그리기 (포인트 이동 스타일)
    if (audioElement.duration) {
        const progress = Math.min((audioElement.currentTime / audioElement.duration), 1);
        const trackHeight = 4; // 프로그레스 타임라인 선 두께 (얇게)

        // 비주얼라이저 바로 밑 적절한 간격을 띄우고 중앙 정렬 배치
        const progressY = baseLineY + 20;

        ctx.save();

        // 뒷배경 트랙 (진하고 얇은 선)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(startX, progressY, visualizerBoxWidth, trackHeight);

        // 현재 재생율까지 채워지는 얇은 선 영역
        ctx.fillStyle = theme.dim; // 은은한 테마색
        ctx.fillRect(startX, progressY, visualizerBoxWidth * progress, trackHeight);

        // 현재 재생 시점을 나타내는 동그란 포인트(Knob) 그리기
        const pointX = startX + (visualizerBoxWidth * progress);
        const pointY = progressY + (trackHeight / 2); // 선의 세로 중앙
        const pointRadius = 15; // 포인트 크기

        ctx.beginPath();
        ctx.arc(pointX, pointY, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = theme.bright; // 쨍한 테마색

        // 포인트에 은은한 섀도우(Glow) 효과 추가
        ctx.shadowColor = theme.shadow;
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.closePath();

        ctx.restore();
    }
}
