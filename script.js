var player;
var videoModal;
var YOUTUBE_API_KEY = "AIzaSyDHjDjcHs4Hc9zRO09l1S63OzC5QLC5DXM"; // WARNING: Insecure for production
var GOOGLE_DRIVE_API_KEY = "AIzaSyBZwyx0cuydOG5wTYzY5PUBfhy3gibLxkA"; // Google Drive API Key
var CLOUDFLARE_PROXIES = [
    "https://googledrive-mp3.wentzaodajiaschool.workers.dev/",
    "https://googledrive-mp3-2.wentzaodajiaschool.workers.dev/"
]; // Cloudflare Worker proxy URLs (will alternate between them)
var currentProxyIndex = 0; // Track which proxy to use
var progressUpdateInterval;
var isDraggingProgressBar = false;
var isAudioMode = false; // Track if we're in audio mode vs video mode
var currentAudioFiles = [];
var currentAudioIndex = -1;
var audioPlayer = null;
var isAudioLoading = false; // Track if audio is currently loading
var DEFAULT_NOW_PLAYING_TEXT = '目前沒有播放內容';
var MOBILE_NOW_PLAYING_QUERY = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(max-width: 576px)') : null;
var nowPlayingMarqueeState = { container: null, titleEl: null, duplicateEl: null, hasTitle: false };
var nowPlayingMarqueeRaf = null;
var nowPlayingMarqueeListenersBound = false;

// This function creates an <iframe> (and YouTube player)
// after the API code downloads.
function onYouTubeIframeAPIReady() {
  console.log("YouTube API Ready");
}

function onPlayerReady(event) {
  event.target.playVideo();
  updatePlayPauseIcon(true);

  if (progressUpdateInterval) clearInterval(progressUpdateInterval);
  progressUpdateInterval = setInterval(updateProgressBar, 250);
}

function onPlayerStateChange(event) {
    let isPlaying = event.data == YT.PlayerState.PLAYING;
    updatePlayPauseIcon(isPlaying);

    if (event.data === YT.PlayerState.PLAYING) {
        if (progressUpdateInterval) clearInterval(progressUpdateInterval);
        progressUpdateInterval = setInterval(updateProgressBar, 250);
    } else {
        clearInterval(progressUpdateInterval);
    }

    // Highlight the currently playing video in the custom playlist
    if (event.data === YT.PlayerState.PLAYING) {
        const videoUrl = event.target.getVideoUrl();
        const videoIdMatch = videoUrl.match(/v=([^&]+)/);
        if (videoIdMatch && videoIdMatch[1]) {
            const currentVideoId = videoIdMatch[1];
            $('.playlist-item').removeClass('active');
            const activeItem = $(`.playlist-item[data-video-id="${currentVideoId}"]`).addClass('active');

            let displayTitle = '';
            if (event.target && typeof event.target.getVideoData === 'function') {
                const videoData = event.target.getVideoData();
                if (videoData && videoData.title) {
                    displayTitle = videoData.title;
                }
            }

            if (!displayTitle && activeItem.length) {
                displayTitle = activeItem.find('.title').text().trim();
            }

            updateNowPlayingDisplay(displayTitle);
        }
    }
}

function updatePlayPauseIcon(isPlaying) {
    const icon = isPlaying ? 'fa-pause' : 'fa-play';
    $('#play-pause-btn').find('i').removeClass('fa-play fa-pause').addClass(icon);
}

function updateNowPlayingDisplay(title) {
    const container = $('#now-playing-container');
    const titleElement = $('#now-playing-title');
    const duplicateElement = $('#now-playing-title-duplicate');

    if (!titleElement.length) {
        return;
    }

    const hasTitle = typeof title === 'string' && title.trim().length > 0;
    const displayTitle = hasTitle ? title.trim() : DEFAULT_NOW_PLAYING_TEXT;
    titleElement.text(displayTitle);
    if (duplicateElement.length) {
        duplicateElement.text(displayTitle);
    }
    if (container.length) {
        container.toggleClass('is-empty', !hasTitle);
    }

    ensureNowPlayingMarqueeListeners();
    scheduleNowPlayingMarqueeRefresh({
        container: container.get(0),
        titleEl: titleElement.get(0),
        duplicateEl: duplicateElement.length ? duplicateElement.get(0) : null,
        hasTitle
    });
}

function ensureNowPlayingMarqueeListeners() {
    if (nowPlayingMarqueeListenersBound) {
        return;
    }

    nowPlayingMarqueeListenersBound = true;

    $(window).on('resize orientationchange', function () {
        scheduleNowPlayingMarqueeRefresh();
    });

    if (MOBILE_NOW_PLAYING_QUERY) {
        const mediaHandler = function () {
            scheduleNowPlayingMarqueeRefresh();
        };

        if (typeof MOBILE_NOW_PLAYING_QUERY.addEventListener === 'function') {
            MOBILE_NOW_PLAYING_QUERY.addEventListener('change', mediaHandler);
        } else if (typeof MOBILE_NOW_PLAYING_QUERY.addListener === 'function') {
            MOBILE_NOW_PLAYING_QUERY.addListener(mediaHandler);
        }
    }
}

function scheduleNowPlayingMarqueeRefresh(update) {
    if (update && typeof update === 'object') {
        if (update.container) {
            nowPlayingMarqueeState.container = update.container;
        }
        if (update.titleEl) {
            nowPlayingMarqueeState.titleEl = update.titleEl;
        }
        if (Object.prototype.hasOwnProperty.call(update, 'duplicateEl')) {
            nowPlayingMarqueeState.duplicateEl = update.duplicateEl;
        }
        if (Object.prototype.hasOwnProperty.call(update, 'hasTitle')) {
            nowPlayingMarqueeState.hasTitle = update.hasTitle;
        }
    }

    if (!nowPlayingMarqueeState.container || !nowPlayingMarqueeState.titleEl) {
        return;
    }

    if (nowPlayingMarqueeRaf) {
        cancelAnimationFrame(nowPlayingMarqueeRaf);
    }

    nowPlayingMarqueeRaf = requestAnimationFrame(runNowPlayingMarqueeRefresh);
}

function runNowPlayingMarqueeRefresh() {
    nowPlayingMarqueeRaf = null;

    const state = nowPlayingMarqueeState;
    if (!state.container || !state.titleEl) {
        return;
    }

    const track = state.container.querySelector('.marquee-track');
    if (!track) {
        return;
    }

    const containerWidth = state.container.clientWidth;
    const textWidth = state.titleEl.scrollWidth;

    if (state.duplicateEl) {
        state.duplicateEl.textContent = state.titleEl.textContent;
    }

    const shouldAnimate = Boolean(state.hasTitle && textWidth > containerWidth);

    if (state.duplicateEl) {
        state.duplicateEl.style.display = shouldAnimate ? '' : 'none';
    }

    state.container.classList.toggle('marquee-enabled', shouldAnimate);

    if (!shouldAnimate) {
        state.container.style.removeProperty('--marquee-mobile-offset');
        state.container.style.removeProperty('--marquee-duration');
        track.style.removeProperty('transform');
        return;
    }

    const mobileOffset = nowPlayingMobileMatches() ? Math.max((containerWidth - textWidth) / 2, 0) : 0;
    state.container.style.setProperty('--marquee-mobile-offset', mobileOffset + 'px');

    const gapValue = getComputedStyle(state.container).getPropertyValue('--marquee-gap') || '32px';
    const parsedGap = parseFloat(gapValue);
    const gap = isNaN(parsedGap) ? 32 : parsedGap;

    const distance = textWidth + gap;
    const speed = 70; // px per second
    const duration = Math.max(distance / speed, 10);
    state.container.style.setProperty('--marquee-duration', duration + 's');

    track.style.removeProperty('transform');
}

function nowPlayingMobileMatches() {
    return MOBILE_NOW_PLAYING_QUERY ? MOBILE_NOW_PLAYING_QUERY.matches : false;
}

function stopVideo() {
    if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
    }
}

function destroyPlayer() {
    if (player && typeof player.destroy === 'function') {
        player.destroy();
    }
    player = null;
}

function formatTime(seconds) {
    seconds = Math.round(seconds);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Audio file type checking
const AUDIO_MIMETYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
    'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a',
    'audio/aac', 'audio/flac', 'audio/webm'
];

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.weba'];

function isAudioFile(file) {
    if (file.mimeType && AUDIO_MIMETYPES.includes(file.mimeType)) {
        return true;
    }
    const fileName = file.name.toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => fileName.endsWith(ext));
}

// Extract folder ID from Google Drive URL or return as-is if already an ID
function extractFolderId(input) {
    if (!input) return null;
    
    // If it's already just an ID (no slashes or special chars), return it
    if (!/[\/\?&=]/.test(input)) {
        return input.trim();
    }
    
    // Extract from URL: https://drive.google.com/drive/folders/FOLDER_ID
    const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input.trim();
}

// Load audio files from Google Drive folder
async function loadGoogleDriveAudioFiles(folderIdOrUrl, coverImageUrl) {
    const folderId = extractFolderId(folderIdOrUrl);
    
    if (!folderId) {
        console.error('Invalid folder ID or URL');
        return;
    }

    updateNowPlayingDisplay('');

    try {
        let allFiles = [];
        let pageToken = null;
        let pageCount = 0;

        // Fetch all files with pagination
        do {
            pageCount++;
            
            let url = `https://www.googleapis.com/drive/v3/files?` +
                `q='${folderId}'+in+parents+and+trashed=false` +
                `&key=${GOOGLE_DRIVE_API_KEY}` +
                `&fields=nextPageToken,files(id,name,mimeType,size)` +
                `&pageSize=1000` +
                `&orderBy=name`;

            if (pageToken) {
                url += `&pageToken=${pageToken}`;
            }

            const response = await fetch(url);
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || '載入失敗');
            }

            const data = await response.json();
            
            if (data.files && data.files.length > 0) {
                allFiles = allFiles.concat(data.files);
            }

            pageToken = data.nextPageToken;

        } while (pageToken);

        // Filter audio files
        currentAudioFiles = allFiles.filter(isAudioFile);

        if (currentAudioFiles.length === 0) {
            console.error('No audio files found in folder');
            return;
        }

        console.log(`Loaded ${currentAudioFiles.length} audio files`);
        
        // Display audio playlist and show cover
        displayAudioPlaylist(coverImageUrl);
        
    } catch (error) {
        console.error('Error loading Google Drive files:', error);
    }
}

// Display audio playlist in the custom playlist area
function displayAudioPlaylist(coverImageUrl, options = {}) {
    const {
        autoPlay = true,
        highlightIndex = currentAudioIndex,
        updateCover = true
    } = options;

    const playlistContainer = $('#custom-playlist');
    playlistContainer.empty();

    if (currentAudioFiles.length === 0) {
        updateNowPlayingDisplay('');
        return;
    }

    currentAudioFiles.forEach((file, index) => {
        const playlistItemHtml = `
            <div class="playlist-item audio-item" data-audio-index="${index}">
                <div class="file-icon">🎵</div>
                <div class="title">${escapeHtml(file.name)}</div>
            </div>
        `;
        playlistContainer.append(playlistItemHtml);
    });

    if (updateCover) {
        if (coverImageUrl) {
            $('#player').html(`<img src="${coverImageUrl}" alt="Album Cover" class="audio-cover-image">`);
        } else {
            $('#player').html(`<div class="audio-cover-placeholder">🎵</div>`);
        }
    }

    const hasValidHighlight = typeof highlightIndex === 'number' && highlightIndex >= 0 && highlightIndex < currentAudioFiles.length;

    if (autoPlay && currentAudioFiles.length > 0) {
        const targetIndex = hasValidHighlight ? highlightIndex : 0;
        playAudioFile(targetIndex);
    } else {
        $('.playlist-item').removeClass('active');
        if (hasValidHighlight) {
            $(`.playlist-item[data-audio-index="${highlightIndex}"]`).addClass('active');
            const highlightedFile = currentAudioFiles[highlightIndex];
            updateNowPlayingDisplay(highlightedFile ? highlightedFile.name : '');
        } else {
            updateNowPlayingDisplay('');
        }
    }
}

// Play audio file by index
function playAudioFile(index) {
    if (index < 0 || index >= currentAudioFiles.length) return;
    
    // Prevent multiple simultaneous loads
    if (isAudioLoading) {
        console.log('Audio is already loading, please wait...');
        return;
    }

    const file = currentAudioFiles[index];
    currentAudioIndex = index;

    // Update UI
    $('.playlist-item').removeClass('active');
    $(`.playlist-item[data-audio-index="${index}"]`).addClass('active');

    updateNowPlayingDisplay(file ? file.name : '');

    // Build play URL - use Cloudflare proxy if configured, otherwise direct API
    let playUrl;
    if (CLOUDFLARE_PROXIES && CLOUDFLARE_PROXIES.length > 0) {
        // Use current proxy and rotate to next one for next request
        const proxy = CLOUDFLARE_PROXIES[currentProxyIndex];
        currentProxyIndex = (currentProxyIndex + 1) % CLOUDFLARE_PROXIES.length;
        playUrl = `${proxy}?id=${file.id}`;
        console.log(`Using proxy ${currentProxyIndex}/${CLOUDFLARE_PROXIES.length}: ${proxy}`);
    } else {
        playUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${GOOGLE_DRIVE_API_KEY}`;
    }

    // Set audio player source
    if (!audioPlayer) {
        audioPlayer = document.getElementById('audio-player-element');
    }

    // Mark as loading
    isAudioLoading = true;
    
    // Pause and reset current playback to avoid interruption errors
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    
    // Load new source
    audioPlayer.src = playUrl;
    audioPlayer.load(); // Explicitly load the new source
    
    // Play when ready
    const playPromise = audioPlayer.play();
    if (playPromise !== undefined) {
        playPromise
            .then(() => {
                isAudioLoading = false;
            })
            .catch(error => {
                console.error('Audio play error:', error);
                isAudioLoading = false;
            });
    } else {
        isAudioLoading = false;
    }

    updatePlayPauseIcon(true);
}

// Update progress bar for audio
function updateAudioProgressBar() {
    if (audioPlayer && !isDraggingProgressBar) {
        const currentTime = audioPlayer.currentTime;
        const duration = audioPlayer.duration;
        
        if (duration > 0 && !isNaN(duration)) {
            const progressPercent = (currentTime / duration) * 100;
            $('#custom-progress-bar').css('width', progressPercent + '%');
            $('#progress-bar-thumb').css('left', progressPercent + '%');
            $('#current-time').text(formatTime(currentTime));
            $('#total-duration').text(formatTime(duration));
        }
    }
}

// Reverse YouTube playlist order
function reverseYouTubePlaylist() {
    const playlistContainer = $('#custom-playlist');
    const items = playlistContainer.children('.playlist-item').toArray();
    
    // Reverse the array
    items.reverse();
    
    // Clear and re-append in reversed order
    playlistContainer.empty();
    items.forEach(item => playlistContainer.append(item));
    
    const activeItem = playlistContainer.find('.playlist-item.active').first();
    if (activeItem.length) {
        updateNowPlayingDisplay(activeItem.find('.title').text().trim());
    }

    console.log('YouTube playlist reversed');
}

// Reverse audio playlist order
function reverseAudioPlaylist() {
    if (!isAudioMode || currentAudioFiles.length === 0) return;
    
    const currentFile = currentAudioFiles[currentAudioIndex];
    
    // Reverse the audio files array
    currentAudioFiles.reverse();
    
    // Find new index of currently playing file
    if (currentFile) {
        currentAudioIndex = currentAudioFiles.findIndex(f => f.id === currentFile.id);
    } else {
        currentAudioIndex = -1;
    }
    
    displayAudioPlaylist(undefined, {
        autoPlay: false,
        highlightIndex: currentAudioIndex,
        updateCover: false
    });
    
    console.log('Audio playlist reversed');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateProgressBar() {
    if (player && player.getDuration && !isDraggingProgressBar) {
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration();
        if (duration > 0) {
            const progressPercent = (currentTime / duration) * 100;
            $('#custom-progress-bar').css('width', progressPercent + '%');
            $('#progress-bar-thumb').css('left', progressPercent + '%');
            $('#current-time').text(formatTime(currentTime));
            $('#total-duration').text(formatTime(duration));
        }
    }
}

// Fetches playlist items from YouTube Data API and displays them
function fetchAndDisplayPlaylist(listId) {
    const playlistContainer = $('#custom-playlist');
    playlistContainer.empty();
    updateNowPlayingDisplay('');

    function fetchPage(pageToken) {
        let apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${listId}&key=${YOUTUBE_API_KEY}`;
        if (pageToken) {
            apiUrl += `&pageToken=${pageToken}`;
        }

        $.ajax({
            url: apiUrl,
            type: "GET",
            success: function(response) {
                response.items.forEach(function(item) {
                    const snippet = item.snippet;
                    const title = snippet.title;
                    const thumbnail = snippet.thumbnails.default.url;
                    const videoId = snippet.resourceId.videoId;

                    if (title !== "Private video" && title !== "Deleted video") {
                        const safeTitle = escapeHtml(title);
                        const playlistItemHtml = `
                            <div class="playlist-item" data-video-id="${videoId}">
                                <img src="${thumbnail}" alt="${safeTitle}">
                                <div class="title">${safeTitle}</div>
                            </div>
                        `;
                        playlistContainer.append(playlistItemHtml);
                    }
                });

                // If there is a next page, recursively fetch it
                if (response.nextPageToken) {
                    fetchPage(response.nextPageToken);
                }
            },
            error: function() {
                console.error("Failed to fetch playlist data from YouTube API.");
                playlistContainer.html('<p class="text-white">無法載入播放清單。</p>');
            }
        });
    }

    fetchPage(null); // Start fetching the first page
}

$(document).ready(function () {
  var allData = []; // 用於儲存從伺服器獲取的完整資料
  videoModal = new bootstrap.Modal(document.getElementById('videoModal'));

  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').then(function(registration) {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      }, function(err) {
        console.log('ServiceWorker registration failed: ', err);
      });
    });
  }

  window.onscroll = function () {
    scrollFunction();
  };

  function scrollFunction() {
    var scrollTopBtn = document.getElementById("scrollTopBtn");
    if (
      document.body.scrollTop > 20 ||
      document.documentElement.scrollTop > 20
    ) {
      scrollTopBtn.style.display = "block";
    } else {
      scrollTopBtn.style.display = "none";
    }
  }

  document
    .getElementById("scrollTopBtn")
    .addEventListener("click", function () {
      document.body.scrollTop = 0; // 對於 Safari
      document.documentElement.scrollTop = 0; // 對於 Chrome, Firefox, IE 和 Opera
    });

  // 函式：根據選擇的學校更新班級選單
  function updateClassesDropdown(selectedSchool) {
    var classes = new Set(); // 使用 Set 來確保不重複
    allData.forEach(function (item) {
      if (item["學校"] === selectedSchool) {
        var className = item["班級"].trim(); // 移除前後空白
        if (className === "") {
          classes.add("Others"); // 如果是空白，則使用 "Others"
        } else {
          classes.add(className);
        }
      }
    });
    var sortedClasses = Array.from(classes).sort(); // 轉換為陣列並排序
    if (sortedClasses.includes("Others")) {
      sortedClasses = sortedClasses.filter((cls) => cls !== "Others"); // 移除 "Others"
      sortedClasses.push("Others"); // 將 "Others" 添加到最後
    }
    $("#class").empty(); // 清空班級選單
    $("#class").append(new Option("All", "")); // 添加預設選項
    sortedClasses.forEach(function (cls) {
      $("#class").append(new Option(cls, cls));
    });
  }

  // 函式：生成相簿卡片
  function generateAlbumCards(albumData) {
    var albumsContainer = $("#albums");
    albumsContainer.empty(); // 清空先前的內容

    // 按專輯名稱排序
    albumData.sort(function (a, b) {
      return a.標題.localeCompare(b.標題);
    });

    albumData.forEach(function (album) {
      var albumHtml = `
		<div class="col-6 col-md-6 col-lg-4 col-xl-3 mb-4">
			<div class="card h-100 d-flex flex-column card-animate" data-school="${album.學校}" data-class="${album.班級}" data-open="${album.開放}" data-playlink="${album.播放連結}">
				<img src="${album.封面連結}" class="card-img-top" alt="${album.標題}">
				<div class="card-body d-flex flex-column">
					<h5 class="card-title mb-3">${album.標題}</h5>
					<!-- 如有其他按鈕或資訊，可在這裡添加 -->
				</div>
			</div>
		</div>
	  `;
      albumsContainer.append(albumHtml);
    });

    // 為卡片添加點擊事件
    $("#albums").off("click", ".card").on("click", ".card", function () {
      var playLink = $(this).data("playlink"); // 獲取卡片的播放鏈接
      var coverImage = $(this).find('.card-img-top').attr('src'); // 獲取封面圖片

      updateNowPlayingDisplay('');

      if (playLink.startsWith("https://www.youtube.com/embed/videoseries?")) {
        // YouTube 播放模式
        isAudioMode = false;
        const listMatch = playLink.match(/list=([^&]+)/);
        if (listMatch && listMatch[1]) {
          const listId = listMatch[1];
          
          fetchAndDisplayPlaylist(listId); // Fetch and build our custom playlist UI

          destroyPlayer(); // Destroy previous player instance if it exists

          player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            playerVars: {
              'playsinline': 1,
              'autoplay': 1,
              'listType': 'playlist',
              'list': listId,
              'controls': 0, // Show YouTube default controls
              'showinfo': 0,
              'rel': 0,
              'iv_load_policy': 3, // Hide annotations
              'modestbranding': 1  // Minimize YouTube logo
            },
            events: {
              'onReady': onPlayerReady,
              'onStateChange': onPlayerStateChange
            }
          });
          videoModal.show();
        }
      } else if (
        playLink.startsWith("https://drive.google.com/drive/folders") ||
        playLink.match(/^[a-zA-Z0-9_-]+$/) // Just a folder ID
      ) {
        // Google Drive 音頻播放模式
        isAudioMode = true;
        destroyPlayer(); // Destroy YouTube player if exists
        
        // Clear player area and prepare for audio mode
        $('#player').empty();
        
        // Load Google Drive audio files
        loadGoogleDriveAudioFiles(playLink, coverImage);
        
        videoModal.show();
      }
    });

    // 監聽模態框關閉事件，清除iframe的src
    $("#videoModal").on("hidden.bs.modal", function (e) {
        destroyPlayer();
        updatePlayPauseIcon(false);
        $('#custom-playlist').empty(); // Clear the custom playlist
        clearInterval(progressUpdateInterval);
        $('#current-time').text('0:00');
        $('#total-duration').text('0:00');
        updateNowPlayingDisplay('');
        
        // Stop and clear audio player
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.src = '';
        }
        isAudioMode = false;
        currentAudioFiles = [];
        currentAudioIndex = -1;
    });

    // Custom controls - support both YouTube and Audio
    $('#play-pause-btn').on('click', function () {
        if (isAudioMode && audioPlayer) {
            // Audio mode
            if (audioPlayer.paused) {
                audioPlayer.play();
                updatePlayPauseIcon(true);
            } else {
                audioPlayer.pause();
                updatePlayPauseIcon(false);
            }
        } else if (player && typeof player.getPlayerState === 'function') {
            // YouTube mode
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                player.pauseVideo();
            } else {
                player.playVideo();
            }
        }
    });

    $('#next-btn').on('click', function () {
        if (isAudioMode) {
            // Audio mode - play next track
            if (currentAudioIndex < currentAudioFiles.length - 1) {
                playAudioFile(currentAudioIndex + 1);
            }
        } else if (player && typeof player.nextVideo === 'function') {
            // YouTube mode
            player.nextVideo();
        }
    });

    $('#prev-btn').on('click', function () {
        if (isAudioMode) {
            // Audio mode - play previous track
            if (currentAudioIndex > 0) {
                playAudioFile(currentAudioIndex - 1);
            }
        } else if (player && typeof player.previousVideo === 'function') {
            // YouTube mode
            player.previousVideo();
        }
    });

    // Click handler for custom playlist items
    $('#custom-playlist').on('click', '.playlist-item', function() {
        if (isAudioMode) {
            // Audio mode - play selected audio file
            const audioIndex = $(this).data('audio-index');
            if (audioIndex !== undefined) {
                playAudioFile(audioIndex);
            }
        } else if (player && typeof player.loadVideoById === 'function') {
            // YouTube mode
            const videoId = $(this).data('video-id');
            const titleText = $(this).find('.title').text().trim();
            updateNowPlayingDisplay(titleText);
            player.loadVideoById(videoId);
        }
    });

    // Reverse order button - 翻轉播放順序
    $('#reverse-order-btn').on('click', function() {
        if (isAudioMode) {
            // Audio mode - reverse audio files array
            reverseAudioPlaylist();
        } else {
            // YouTube mode - reverse playlist items
            reverseYouTubePlaylist();
        }
    });

    // 添加動畫
    setTimeout(function () {
      $(".card-animate").addClass("show");
    }, 100);
  }

  // 函式：根據下拉選單選擇過濾專輯卡片
  function filterAlbumsBySelection() {
    var selectedSchool = $("#school").val();
    var selectedClass = $("#class").val();

    $("#albums .card").each(function () {
      var cardSchool = $(this).data("school");
      var cardClass = $(this).data("class");
      var cardOpen = $(this).data("open");

      var isSchoolMatch = selectedSchool === cardSchool || selectedSchool === "All"; // 如果選擇了特定學校或所有學校
      var isClassMatch =
        selectedClass === "All" ||
        cardClass === selectedClass ||
        (selectedClass === "Others" && cardClass === "");

      if (isSchoolMatch && (isClassMatch || selectedClass === "") && cardOpen === true) {
        // 僅當 cardOpen 為 true 時顯示
        $(this).parent().show(); // 顯示符合條件的卡片
      } else {
        $(this).parent().hide(); // 隱藏不符合條件的卡片
      }
    });
  }

  // 首字大寫
  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
  }

  // 函式：從本地 data.json 獲取資料並填充下拉選單
  function fetchAndFillDropdownsFromLocal() {
    $.ajax({
      url: "https://rainbowstudent.wentzao.com/mediacenter/api/data", // 從本地 JSON 檔案變更
      type: "GET",
      dataType: "json", // 需要 JSON 回應
      success: function (data) {
        console.log("本地資料請求成功", data);
        allData = data.data; // 儲存完整資料

        // 僅排序一次資料
        allData.sort(function (a, b) {
            return a.標題.localeCompare(b.標題);
        });

        // 一次性生成所有卡片
        generateAlbumCards(allData);

        // 填充學校下拉選單
        var schools = new Set();
        allData.forEach(function (item) {
            schools.add(item["學校"]);
        });
        
        var schoolSelect = $("#school");
        schoolSelect.empty();
        schools.forEach(function (school) {
            schoolSelect.append(new Option(school, school));
        });

        // 處理 URL 參數或設定預設值
        var urlParams = new URLSearchParams(window.location.search);
        var schoolParam = urlParams.get("school");

        if (schoolParam) {
            schoolParam = capitalizeFirstLetter(schoolParam);
            if (Array.from(schools).includes(schoolParam)) {
                schoolSelect.val(schoolParam).prop("disabled", true);
            }
        }
        
        // 以程式化方式觸發 change 事件以設定初始狀態
        schoolSelect.trigger("change");
      },
      error: function () {
        console.error("本地資料請求失敗");
      },
    });
  }

  // 函式：從遠端 URL 獲取資料並填充下拉選單
  function fetchAndFillDropdownsFromRemote() {
    $.ajax({
      url: "https://script.google.com/macros/s/AKfycbyKDtd2gD3GPRggKCaZ67uL3vHYPFfyS5zjZtuS83Li0Fes0cZv29dlF-bkTxFCs3DSpA/exec",
      type: "GET",
      success: function (data) {
        console.log("遠端資料請求成功", data);
        allData = data; // 儲存完整資料

        // 後續邏輯與本地版本相同，可以考慮合併
        // 僅排序一次資料
        allData.sort(function (a, b) {
            return a.標題.localeCompare(b.標題);
        });

        // 一次性生成所有卡片
        generateAlbumCards(allData);

        // 填充學校下拉選單
        var schools = new Set();
        allData.forEach(function (item) {
            schools.add(item["學校"]);
        });

        var schoolSelect = $("#school");
        schoolSelect.empty();
        schools.forEach(function (school) {
            schoolSelect.append(new Option(school, school));
        });

        // 處理 URL 參數或設定預設值
        var urlParams = new URLSearchParams(window.location.search);
        var schoolParam = urlParams.get("school");

        if (schoolParam) {
            schoolParam = capitalizeFirstLetter(schoolParam);
            if (Array.from(schools).includes(schoolParam)) {
                schoolSelect.val(schoolParam).prop("disabled", true);
            }
        }

        // 以程式化方式觸發 change 事件以設定初始狀態
        schoolSelect.trigger("change");
      },
      error: function () {
        console.error("遠端資料請求失敗");
      },
    });
  }

  // 分離的事件處理程序
  $("#school").change(function () {
    var selectedSchool = $(this).val();
    updateClassesDropdown(selectedSchool);
    filterAlbumsBySelection();
  });

  $("#class").change(function () {
    filterAlbumsBySelection();
  });

  // 呼叫函式以填充下拉選單和生成相簿卡片
  fetchAndFillDropdownsFromLocal();

  function setupProgressBarHandlers() {
    const progressBarContainer = $('#custom-progress-bar-container');
    const thumb = $('#progress-bar-thumb');
    const tooltip = $('#progress-tooltip');

    const seekFromEvent = (e) => {
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        if (clientX === undefined) return;

        const rect = progressBarContainer[0].getBoundingClientRect();
        const offsetX = clientX - rect.left;
        const width = progressBarContainer.width();
        let progressPercent = (offsetX / width) * 100;

        progressPercent = Math.max(0, Math.min(100, progressPercent));
        
        let duration = 0;
        
        if (isAudioMode && audioPlayer) {
            duration = audioPlayer.duration;
        } else if (player && player.getDuration) {
            duration = player.getDuration();
        }
        
        if (duration > 0 && !isNaN(duration)) {
            const seekTime = (duration * progressPercent) / 100;
            
            // Only seek if the user is not just hovering
            if (isDraggingProgressBar) {
                if (isAudioMode && audioPlayer) {
                    audioPlayer.currentTime = seekTime;
                } else if (player && player.seekTo) {
                player.seekTo(seekTime, true);
                }
            }
            
            $('#custom-progress-bar').css('width', progressPercent + '%');
            $('#progress-bar-thumb').css('left', progressPercent + '%');

            // Update tooltip
            tooltip.text(formatTime(seekTime));
            tooltip.css('left', progressPercent + '%');
        }
    };

    thumb.on('mousedown touchstart', function(e) {
        e.preventDefault();
        isDraggingProgressBar = true;
        tooltip.css('opacity', '1');
    });

    $(window).on('mousemove touchmove', function(e) {
        if (!isDraggingProgressBar) return;
        e.preventDefault();
        seekFromEvent(e);
    }).on('mouseup touchend', function(e) {
        if (isDraggingProgressBar) {
            isDraggingProgressBar = false;
            tooltip.css('opacity', '0');
            
            // Final seek on release
            const progressPercent = parseFloat(thumb.css('left')) / progressBarContainer.width();
            
            if (isAudioMode && audioPlayer) {
                audioPlayer.currentTime = audioPlayer.duration * progressPercent;
            } else if (player && player.seekTo && player.getDuration) {
                player.seekTo(player.getDuration() * progressPercent, true);
            }
        }
    });

    progressBarContainer.on('click', function(e) {
        if (e.target.id === 'progress-bar-thumb') return;
        
        // Calculate progress percentage from click position
        const rect = progressBarContainer[0].getBoundingClientRect();
        const clickX = (e.clientX || e.touches?.[0]?.clientX || 0) - rect.left;
        const progressPercent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
        
        // Update visual position
        $('#custom-progress-bar').css('width', progressPercent + '%');
        $('#progress-bar-thumb').css('left', progressPercent + '%');
        
        // Actually seek to the position
        if (isAudioMode && audioPlayer) {
            audioPlayer.currentTime = audioPlayer.duration * (progressPercent / 100);
        } else if (player && player.seekTo && player.getDuration) {
            player.seekTo(player.getDuration() * (progressPercent / 100), true);
        }
    });
  }

  // Setup audio player event listeners
  function setupAudioPlayerListeners() {
    audioPlayer = document.getElementById('audio-player-element');
    
    if (audioPlayer) {
        // Update progress bar
        audioPlayer.addEventListener('timeupdate', function() {
            if (isAudioMode) {
                updateAudioProgressBar();
            }
        });
        
        // Auto-play next track when current ends
        audioPlayer.addEventListener('ended', function() {
            if (currentAudioIndex < currentAudioFiles.length - 1) {
                playAudioFile(currentAudioIndex + 1);
            } else {
                updatePlayPauseIcon(false);
            }
        });
        
        // Handle play/pause events
        audioPlayer.addEventListener('play', function() {
            updatePlayPauseIcon(true);
            if (progressUpdateInterval) clearInterval(progressUpdateInterval);
            progressUpdateInterval = setInterval(updateAudioProgressBar, 250);
        });
        
        audioPlayer.addEventListener('pause', function() {
            updatePlayPauseIcon(false);
            clearInterval(progressUpdateInterval);
        });
        
        // Handle loading events
        audioPlayer.addEventListener('loadstart', function() {
            console.log('Audio loading started...');
        });
        
        audioPlayer.addEventListener('canplay', function() {
            console.log('Audio can start playing');
            isAudioLoading = false;
        });
        
        audioPlayer.addEventListener('error', function(e) {
            console.error('Audio error:', e);
            isAudioLoading = false; // Reset loading flag on error
        });
    }
  }

  setupProgressBarHandlers();
  setupAudioPlayerListeners();
});