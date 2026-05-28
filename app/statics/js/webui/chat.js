(() => {
  const VERIFY_ENDPOINT = '/webui/api/verify';
  const MODELS_ENDPOINT = '/webui/api/models';
  const CHAT_ENDPOINT = '/webui/api/chat/completions';
  const VOICE_ENDPOINT = '/webui/api/voice/token';
  const PREFERRED_MODEL = 'grok-4.20-0309-non-reasoning';
  const STORE_KEY = 'grok2api_webui_chat_sessions_v1';
  const SIDEBAR_STORE_KEY = 'grok2api_webui_sidebar_collapsed_v1';
  const VOICE_PREF_KEY = 'grok2api_voice_id';
  const VOICE_HISTORY_KEY = 'grok2api_voice_chat_history';
  const VOICE_SESSIONS_KEY = 'grok2api_voice_sessions_v1';
  const VOICE_RESUME_CONTEXT_KEY = 'grok2api_voice_resume_context';
  const PERSONALITY_PREF_KEY = 'grok2api_voice_personality';
  const CUSTOM_PERSONALITIES_KEY = 'grok2api_voice_custom_personalities';
  const CUSTOM_DRAFT_KEY = 'grok2api_voice_custom_draft';
  const CUSTOM_NEW_VALUE = 'custom_new';
  const CUSTOM_PERSONALITY_PREFIX = 'custom:';
  const VOICE_HISTORY_LIMIT = 8;
  const READ_ALOUD_ENABLED = true;

  const chatLayout = document.getElementById('chatLayout');
  const modelSelect = document.getElementById('modelSelect');
  const systemInput = document.getElementById('systemInput');
  const thread = document.getElementById('thread');
  const emptyState = document.getElementById('emptyState');
  const statusEl = document.getElementById('status');
  const promptInput = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  const inputShell = document.querySelector('.webui-input-shell');
  const chatVoiceBtn = document.getElementById('chatVoiceBtn');
  const chatVoiceSelect = document.getElementById('chatVoiceSelect');
  const chatVoicePersonalityPanel = document.getElementById('chatVoicePersonalityPanel');
  const chatVoicePersonalitySelect = document.getElementById('chatVoicePersonalitySelect');
  const chatVoiceInstructionPill = document.getElementById('chatVoiceInstructionPill');
  const chatVoiceCustomPersonalityNameInput = document.getElementById('chatVoiceCustomPersonalityNameInput');
  const chatVoiceInstructionInput = document.getElementById('chatVoiceInstructionInput');
  const chatVoiceSaveCustomPersonalityBtn = document.getElementById('chatVoiceSaveCustomPersonalityBtn');
  const chatVoiceDeleteCustomPersonalityBtn = document.getElementById('chatVoiceDeleteCustomPersonalityBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const sessionList = document.getElementById('sessionList');
  const voiceHistoryList = document.getElementById('voiceHistoryList');
  const continueVoiceBtn = document.getElementById('continueVoiceBtn');
  const newVoiceSessionBtn = document.getElementById('newVoiceSessionBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileInput = document.getElementById('fileInput');
  const uploadMeta = document.getElementById('uploadMeta');
  const sessionModal = document.getElementById('sessionModal');
  const sessionModalTitle = document.getElementById('sessionModalTitle');
  const sessionModalDesc = document.getElementById('sessionModalDesc');
  const sessionModalInputWrap = document.getElementById('sessionModalInputWrap');
  const sessionModalInput = document.getElementById('sessionModalInput');
  const sessionModalCancel = document.getElementById('sessionModalCancel');
  const sessionModalConfirm = document.getElementById('sessionModalConfirm');

  let sessions = [];
  let currentSessionId = '';
  let messages = [];
  let abortController = null;
  let sending = false;
  let pendingFiles = [];
  let modalResolver = null;
  let sidebarCollapsed = false;
  let availableModels = [];
  let activeEdit = null;
  const PROMPT_MIN_HEIGHT = 36;
  const PROMPT_MAX_HEIGHT = 108;
  let pendingThreadScrollFrame = 0;
  let sessionListRenderSignature = '';
  let showingVoiceHistory = false;
  let voiceSessions = [];
  let currentVoiceSessionId = '';
  let chatVoiceRoom = null;
  let chatVoiceConnecting = false;
  let chatVoiceConnected = false;
  let chatVoiceSending = false;
  let chatVoiceAssistantEntry = null;
  let chatVoiceAssistantKey = '';
  let chatVoiceLastSentText = '';
  const chatVoiceRecentSentTexts = new Map();
  let chatVoiceCommittedResponseIds = new Set();
  let chatVoiceCustomPersonalities = [];
  const chatVoiceAudioElements = new Set();

  function text(key, fallback, params) {
    if (typeof window.t !== 'function') return fallback;
    const value = t(key, params);
    return value === key ? fallback : value;
  }

  function toast(message, type = 'info') {
    if (typeof showToast === 'function') showToast(message, type);
  }

  function formatModelOptionLabel(modelId, fallbackName) {
    const normalized = String(modelId || '').trim().toLowerCase();
    if (!normalized) return fallbackName || '';

    return normalized
      .split('-')
      .filter(Boolean)
      .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
      .join(' ');
  }

  function modelRouteBadge(item) {
    if (!item || typeof item !== 'object') return '';
    let badge = '';
    if (typeof item.badge === 'string' && item.badge.trim()) {
      badge = item.badge.trim();
    } else if (item.free_web === true) {
      badge = 'Free Web';
    } else if (item.route === 'console') {
      badge = 'Console';
    } else if (item.route === 'web') {
      badge = 'Official Web';
    }
    return badge;
  }

  function currentSystemPrompt() {
    return systemInput ? (systemInput.value || '').trim() : '';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hasVisibleReasoning(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function hasMessageContent(value) {
    const textValue = typeof value === 'string' ? value : extractTextContent(value);
    return Boolean((textValue || '').trim());
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(value, window.location.origin);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function sanitizeRenderedHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']);

    function walk(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.tagName.toLowerCase();

      if (blockedTags.has(tag)) {
        el.remove();
        return;
      }

      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          return;
        }
        if ((name === 'href' || name === 'src') && !sanitizeUrl(value)) {
          el.removeAttribute(attr.name);
          return;
        }
        if (name === 'target') {
          el.setAttribute('target', '_blank');
        }
      });

      Array.from(el.children).forEach((child) => walk(child));
    }

    Array.from(template.content.children).forEach((child) => walk(child));
    return template.innerHTML;
  }

  function renderInlineMarkdown(source) {
    let html = escapeHtml(source);
    html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeUrl(href.trim());
      const safeLabel = label.trim() || href.trim();
      return safeHref
        ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${safeLabel}</a>`
        : safeLabel;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^\*])\*([^*]+)\*/g, '$1<em>$2</em>');
    return html;
  }

  function renderMarkdown(source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    const paragraph = [];
    let listType = '';
    let listItems = [];
    let inCodeBlock = false;
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`);
      paragraph.length = 0;
    }

    function flushList() {
      if (!listItems.length) return;
      html.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${listType}>`);
      listItems = [];
      listType = '';
    }

    function flushCodeBlock() {
      if (!inCodeBlock) return;
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      inCodeBlock = false;
      codeLines = [];
    }

    for (const line of lines) {
      if (line.startsWith('```')) {
        flushParagraph();
        flushList();
        if (inCodeBlock) {
          flushCodeBlock();
        } else {
          inCodeBlock = true;
          codeLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
      const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      const quoteMatch = trimmed.match(/^>\s?(.*)$/);

      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }

      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = headingMatch[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
        continue;
      }

      if (unorderedMatch || orderedMatch) {
        flushParagraph();
        const nextType = unorderedMatch ? 'ul' : 'ol';
        const itemText = unorderedMatch ? unorderedMatch[1] : orderedMatch[1];
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        listItems.push(itemText);
        continue;
      }

      flushList();

      if (quoteMatch) {
        flushParagraph();
        html.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1])}</blockquote>`);
        continue;
      }

      paragraph.push(line);
    }

    flushParagraph();
    flushList();
    flushCodeBlock();
    return html.join('') || '<p></p>';
  }

  function _extractMath(source) {
    const placeholders = [];
    // Display math: $$...$$ (must come before inline to avoid double-match)
    let out = source.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      const i = placeholders.length;
      placeholders.push({ tex, display: true });
      return `\x02MATH${i}\x03`;
    });
    // Inline math: $...$  (single-line only, no space at edges to avoid false positives)
    out = out.replace(/\$([^\n$]+?)\$/g, (_, tex) => {
      const i = placeholders.length;
      placeholders.push({ tex, display: false });
      return `\x02MATH${i}\x03`;
    });
    return { out, placeholders };
  }

  function renderRichMarkdown(source) {
    if (window.marked && typeof window.marked.parse === 'function') {
      let toRender = normalizeMediaContent(source);
      let placeholders = [];

      if (window.katex) {
        const extracted = _extractMath(toRender);
        toRender = extracted.out;
        placeholders = extracted.placeholders;
      }

      let rendered = window.marked.parse(toRender, {
        async: false,
        breaks: true,
        gfm: true,
      });

      if (window.katex && placeholders.length) {
        rendered = rendered.replace(/\x02MATH(\d+)\x03/g, (_, idx) => {
          const { tex, display } = placeholders[parseInt(idx, 10)];
          try {
            return window.katex.renderToString(tex, { displayMode: display, throwOnError: false });
          } catch (_e) {
            return escapeHtml(display ? `$$${tex}$$` : `$${tex}$`);
          }
        });
      }

      return sanitizeRenderedHtml(rendered);
    }
    return renderMarkdown(source);
  }

  function isImageUrl(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.includes('/v1/files/image')
      || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(normalized)
      || normalized.startsWith('data:image/');
  }

  function isVideoUrl(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.includes('/v1/files/video')
      || /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/.test(normalized);
  }

  function normalizeMediaContent(source) {
    const input = String(source || '').replace(/\[video\]\(([^)]+)\)/gi, '$1');
    return input.replace(/^(https?:\/\/\S+|\/v1\/files\/(?:image|video)\?id=\S+|data:image\/[^\s]+)$/gm, (match) => {
      const url = match.trim();
      if (isImageUrl(url)) return `![image](${url})`;
      if (isVideoUrl(url)) return `<video controls preload="metadata" src="${escapeHtml(url)}"></video>`;
      return match;
    });
  }

  function isNativeGrokMediaUrl(value) {
    try {
      const url = new URL(value, window.location.origin);
      return /(^|\.)grok\.com$/i.test(url.hostname);
    } catch {
      return false;
    }
  }

  function showMediaProxyHint(media, type) {
    if (!media || media.nextElementSibling?.classList?.contains('msg-media-error')) return;
    const hint = document.createElement('div');
    hint.className = 'msg-media-error';
    if (type === 'image') {
      hint.textContent = text(
        'webui.chat.errors.imageProxyRequired',
        'Image failed to load. Set APP Base URL and change image output format to local_url, local_md, or base64.'
      );
    } else {
      hint.textContent = text(
        'webui.chat.errors.videoProxyRequired',
        'Video loading returned 403. Go to the admin page, set the APP Base URL, then change the video output format to local proxy mode (local_url or local_html) and retry.'
      );
    }
    media.insertAdjacentElement('afterend', hint);
  }

  function clearMediaProxyHint(media) {
    const hint = media && media.nextElementSibling;
    if (hint?.classList?.contains('msg-media-error')) hint.remove();
  }

  function enhanceMediaElements(card) {
    card.querySelectorAll('video').forEach((video) => {
      if (video.dataset.proxyHintBound === '1') return;
      video.dataset.proxyHintBound = '1';
      const onVideoError = () => showMediaProxyHint(video, 'video');
      video.addEventListener('error', onVideoError);
      video.querySelectorAll('source').forEach((source) => {
        source.addEventListener('error', onVideoError);
      });
      video.addEventListener('loadedmetadata', () => clearMediaProxyHint(video));
      if (video.error) showMediaProxyHint(video, 'video');
    });

    card.querySelectorAll('img').forEach((img) => {
      if (img.dataset.proxyHintBound === '1') return;
      img.dataset.proxyHintBound = '1';
      img.addEventListener('error', () => {
        if (isNativeGrokMediaUrl(img.currentSrc || img.src)) showMediaProxyHint(img, 'image');
      });
      img.addEventListener('load', () => clearMediaProxyHint(img));
      if (img.complete && img.naturalWidth === 0 && isNativeGrokMediaUrl(img.currentSrc || img.src)) {
        showMediaProxyHint(img, 'image');
      }
    });
  }

  function extractTextContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string' && block.text.trim())
      .map((block) => block.text.trim())
      .join('\n');
  }

  function extractImageUrls(content) {
    if (!Array.isArray(content)) return [];
    return content.flatMap((block) => {
      if (!block || block.type !== 'image_url') return [];
      const image = block.image_url;
      if (typeof image === 'string' && image.trim()) return [image.trim()];
      if (image && typeof image.url === 'string' && image.url.trim()) return [image.url.trim()];
      return [];
    });
  }

  function extractFileItems(content) {
    if (!Array.isArray(content)) return [];
    return content.flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      if (block.type === 'input_audio') {
        const audio = block.input_audio || {};
        const filename = String(audio.filename || '').trim();
        return [{ kind: 'audio', name: filename || 'audio' }];
      }
      if (block.type === 'file') {
        const file = block.file || {};
        const filename = String(file.filename || '').trim();
        return [{ kind: 'file', name: filename || 'file' }];
      }
      return [];
    });
  }

  function dataUrlMime(value) {
    const match = String(value || '').match(/^data:([^;,]+)[;,]/i);
    return match ? match[1].toLowerCase() : 'application/octet-stream';
  }

  function fallbackNameForMime(mime) {
    if (mime.startsWith('image/')) return `image.${mime.split('/')[1] || 'png'}`;
    if (mime.startsWith('audio/')) return `audio.${mime.split('/')[1] || 'wav'}`;
    return `file.${mime.split('/')[1] || 'bin'}`;
  }

  function extractEditablePendingFiles(content) {
    if (!Array.isArray(content)) return [];
    return content.flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      if (block.type === 'image_url') {
        const image = block.image_url;
        const url = typeof image === 'string' ? image : image && typeof image.url === 'string' ? image.url : '';
        if (!url || !url.startsWith('data:')) return [];
        const mime = dataUrlMime(url);
        return [{
          name: fallbackNameForMime(mime),
          type: mime,
          size: 0,
          dataUrl: url,
        }];
      }
      if (block.type === 'input_audio') {
        const audio = block.input_audio || {};
        const data = String(audio.data || '').trim();
        if (!data) return [];
        const mime = dataUrlMime(data);
        return [{
          name: String(audio.filename || '').trim() || fallbackNameForMime(mime),
          type: mime,
          size: 0,
          dataUrl: data,
        }];
      }
      if (block.type === 'file') {
        const file = block.file || {};
        const data = String(file.file_data || '').trim();
        if (!data) return [];
        const mime = dataUrlMime(data);
        return [{
          name: String(file.filename || '').trim() || fallbackNameForMime(mime),
          type: mime,
          size: 0,
          dataUrl: data,
        }];
      }
      return [];
    });
  }

  async function copyToClipboard(value) {
    const textValue = String(value || '');
    if (!textValue) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(textValue);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = textValue;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function beginEditMessage(messageIndex, content) {
    activeEdit = {
      messageIndex,
      text: extractTextContent(content) || (typeof content === 'string' ? content : ''),
      files: extractEditablePendingFiles(content),
    };
    renderThread();
  }

  function summarizeMessageContent(content) {
    const textContent = extractTextContent(content).trim();
    const imageCount = extractImageUrls(content).length;
    const fileCount = extractFileItems(content).length;
    const parts = [];
    if (textContent) parts.push(textContent);
    if (imageCount) parts.push(`[${imageCount} image${imageCount > 1 ? 's' : ''}]`);
    if (fileCount) parts.push(`[${fileCount} file${fileCount > 1 ? 's' : ''}]`);
    return parts.join('\n\n');
  }

  function renderMessageContent(card, role, content) {
    if (Array.isArray(content)) {
      const textContent = extractTextContent(content);
      const imageUrls = extractImageUrls(content);
      const fileItems = extractFileItems(content);
      if (role === 'assistant') {
        const parts = [];
        if (textContent.trim()) parts.push(renderRichMarkdown(textContent));
        if (imageUrls.length) {
          parts.push(imageUrls.map((url) => (
            `<div class="msg-inline-media"><img src="${escapeHtml(url)}" alt="image" loading="lazy"></div>`
          )).join(''));
        }
        card.innerHTML = parts.join('') || '<p></p>';
        enhanceMediaElements(card);
        return;
      }

      const body = document.createElement('div');
      body.className = 'msg-user-parts';
      if (textContent.trim()) {
        const textNode = document.createElement('div');
        textNode.className = 'msg-user-text';
        textNode.textContent = textContent;
        body.appendChild(textNode);
      }
      if (imageUrls.length) {
        const gallery = document.createElement('div');
        gallery.className = 'msg-user-gallery';
        imageUrls.forEach((url) => {
          const img = document.createElement('img');
          img.src = url;
          img.alt = 'image';
          img.loading = 'lazy';
          gallery.appendChild(img);
        });
        body.appendChild(gallery);
      }
      if (fileItems.length) {
        const attachments = document.createElement('div');
        attachments.className = 'msg-user-files';
        fileItems.forEach((item) => {
          const chip = document.createElement('div');
          chip.className = 'msg-user-file';
          chip.textContent = item.name;
          attachments.appendChild(chip);
        });
        body.appendChild(attachments);
      }
      card.replaceChildren(body);
      return;
    }

    if (role === 'assistant') {
      card.innerHTML = renderRichMarkdown(content);
      enhanceMediaElements(card);
      return;
    }
    card.textContent = content;
  }

  function renderAssistantWaiting(card) {
    card.innerHTML = '<div class="msg-loading" aria-hidden="true"><span class="msg-loading-spinner"></span></div>';
  }

  function parseSseEvent(chunk) {
    let event = 'message';
    const dataLines = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    return { event, data: dataLines.join('\n') };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { sessions: [], currentSessionId: '' };
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { sessions: parsed, currentSessionId: parsed[0] && parsed[0].id || '' };
      return {
        sessions: Array.isArray(parsed && parsed.sessions) ? parsed.sessions : [],
        currentSessionId: parsed && parsed.currentSessionId ? String(parsed.currentSessionId) : '',
      };
    } catch {
      return { sessions: [], currentSessionId: '' };
    }
  }

  function persistStore() {
    const serializedSessions = sessions.map((session) => ({
      ...session,
      messages: Array.isArray(session.messages)
        ? session.messages.map((message) => ({
            ...message,
            content: Array.isArray(message.content)
              ? summarizeMessageContent(message.content)
              : message.content,
          }))
        : [],
    }));
    localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: serializedSessions, currentSessionId }));
  }

  function applySidebarState() {
    if (!chatLayout || !sidebarToggleBtn) return;
    chatLayout.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    sidebarToggleBtn.setAttribute('aria-expanded', String(!sidebarCollapsed));
  }

  function loadSidebarState() {
    try {
      sidebarCollapsed = localStorage.getItem(SIDEBAR_STORE_KEY) === 'true';
    } catch {
      sidebarCollapsed = false;
    }
    applySidebarState();
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    applySidebarState();
    try {
      localStorage.setItem(SIDEBAR_STORE_KEY, String(sidebarCollapsed));
    } catch {}
  }

  function openVoicePage() {
    window.location.href = '/webui/chatkit';
  }

  function normalizeVoiceMessage(message) {
    return {
      id: String(message && message.id || '').trim(),
      role: message && ['user', 'assistant'].includes(message.role) ? message.role : 'system',
      text: String(message && message.text || '').trim(),
      timestamp: Number(message && message.timestamp) || 0,
    };
  }

  function isDuplicateVoiceSessionMessage(messagesList, role, content, id = '') {
    const normalized = String(content || '').trim();
    if (!normalized) return true;
    return messagesList.some((entry) => {
      if (!entry || entry.role !== role) return false;
      if (id && entry.id === id) return true;
      return String(entry.text || '').trim() === normalized;
    });
  }

  function dedupeVoiceHistoryMessages(items) {
    const seen = new Set();
    return (items || []).filter((entry) => {
      if (!entry || !entry.text || entry.role === 'system') return false;
      const key = `${entry.role}:${entry.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function createVoiceSessionTitle(items) {
    const first = (items || []).find((item) => item && item.role === 'user' && String(item.text || '').trim());
    const raw = String(first && first.text || '').trim().replace(/\s+/g, ' ');
    if (!raw) return 'Voice Session';
    return raw.length > 24 ? `${raw.slice(0, 24)}...` : raw;
  }

  function createVoiceSession(messagesList = []) {
    return {
      id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: createVoiceSessionTitle(messagesList),
      messages: messagesList,
      updatedAt: Date.now(),
    };
  }

  function normalizeVoiceSession(item) {
    const messagesList = Array.isArray(item && item.messages)
      ? dedupeVoiceHistoryMessages(item.messages.map(normalizeVoiceMessage).filter((message) => message.id && message.text))
      : [];
    return {
      id: String(item && item.id || '').trim() || `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: String(item && item.title || '').trim() || createVoiceSessionTitle(messagesList),
      messages: messagesList,
      updatedAt: Number(item && item.updatedAt) || Date.now(),
    };
  }

  function saveVoiceSessions() {
    try {
      localStorage.setItem(VOICE_SESSIONS_KEY, JSON.stringify({
        currentSessionId: currentVoiceSessionId,
        sessions: voiceSessions,
      }));
      const current = currentVoiceSession();
      localStorage.setItem(VOICE_HISTORY_KEY, JSON.stringify(current ? current.messages : []));
    } catch {}
  }

  function loadVoiceSessions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(VOICE_SESSIONS_KEY) || '{}');
      voiceSessions = Array.isArray(parsed && parsed.sessions)
        ? parsed.sessions.map(normalizeVoiceSession)
        : [];
      currentVoiceSessionId = String(parsed && parsed.currentSessionId || '').trim();
    } catch {
      voiceSessions = [];
      currentVoiceSessionId = '';
    }

    if (!voiceSessions.length) {
      try {
        const legacy = JSON.parse(localStorage.getItem(VOICE_HISTORY_KEY) || '[]');
        const legacyMessages = Array.isArray(legacy)
          ? legacy.map(normalizeVoiceMessage).filter((message) => message.id && message.text)
          : [];
        voiceSessions = [createVoiceSession(legacyMessages)];
      } catch {
        voiceSessions = [createVoiceSession()];
      }
      currentVoiceSessionId = voiceSessions[0].id;
      saveVoiceSessions();
    }
    if (!voiceSessions.some((session) => session.id === currentVoiceSessionId)) {
      currentVoiceSessionId = voiceSessions[0].id;
    }
  }

  function currentVoiceSession() {
    return voiceSessions.find((session) => session.id === currentVoiceSessionId) || null;
  }

  function loadVoiceHistory(sessionId = currentVoiceSessionId) {
    loadVoiceSessions();
    const session = voiceSessions.find((item) => item.id === sessionId) || currentVoiceSession();
    const raw = session ? session.messages : [];
    return dedupeVoiceHistoryMessages(raw.map(normalizeVoiceMessage));
  }

  function startNewVoiceSession() {
    const session = createVoiceSession();
    voiceSessions.unshift(session);
    currentVoiceSessionId = session.id;
    saveVoiceSessions();
    renderVoiceHistory();
    renderVoiceHistoryThread();
  }

  function deleteVoiceSession(sessionId) {
    loadVoiceSessions();
    voiceSessions = voiceSessions.filter((session) => session.id !== sessionId);
    if (!voiceSessions.length) voiceSessions = [createVoiceSession()];
    if (!voiceSessions.some((session) => session.id === currentVoiceSessionId)) {
      currentVoiceSessionId = voiceSessions[0].id;
    }
    saveVoiceSessions();
    renderVoiceHistory();
    renderVoiceHistoryThread();
  }

  function formatVoiceHistoryTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function renderVoiceHistory() {
    if (!voiceHistoryList) return;
    loadVoiceSessions();
    let visibleSessions = voiceSessions.slice(0, VOICE_HISTORY_LIMIT);
    const currentSession = currentVoiceSession();
    if (!visibleSessions.length && currentSession && Array.isArray(currentSession.messages) && currentSession.messages.some((entry) => entry && entry.role !== 'system' && String(entry.text || '').trim())) {
      visibleSessions = [currentSession];
    }
    voiceHistoryList.dataset.empty = text('webui.chat.voiceHistoryEmpty', '暂无语音记录');
    if (!visibleSessions.length) {
      voiceHistoryList.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    visibleSessions.forEach((session) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `webui-voice-history-item${session.id === currentVoiceSessionId ? ' active' : ''}`;

      const meta = document.createElement('div');
      meta.className = 'webui-voice-history-meta';
      const timeValue = formatVoiceHistoryTime(session.updatedAt);
      const count = (session.messages || []).filter((entry) => entry.role === 'user' || entry.role === 'assistant').length;
      meta.textContent = [timeValue, `${count} 条`].filter(Boolean).join(' · ');

      const body = document.createElement('div');
      body.className = 'webui-voice-history-body';
      body.textContent = session.title || createVoiceSessionTitle(session.messages);

      const actions = document.createElement('div');
      actions.className = 'webui-voice-history-row-actions';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'webui-voice-history-delete';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteVoiceSession(session.id);
      });
      actions.appendChild(deleteBtn);

      item.appendChild(meta);
      item.appendChild(body);
      item.appendChild(actions);
      item.addEventListener('click', () => {
        currentVoiceSessionId = session.id;
        saveVoiceSessions();
        renderVoiceHistory();
        renderVoiceHistoryThread();
      });
      fragment.appendChild(item);
    });
    voiceHistoryList.replaceChildren(fragment);
  }

  function buildVoiceResumeText() {
    const history = loadVoiceHistory();
    return history
      .map((entry) => `${entry.role === 'user' ? '用户' : 'Grok'}: ${entry.text}`)
      .join('\n')
      .slice(-3000);
  }

  function buildChatVoiceInstruction() {
    const baseInstruction = selectedChatVoiceCustomInstruction();
    const resumeTranscript = buildVoiceResumeText();
    if (!resumeTranscript) return baseInstruction;
    const resumeInstruction = [
      'Continue the previous Grok Voice conversation using this recent transcript as context.',
      `Keep the selected voice personality: ${selectedChatVoicePersonality()}.`,
      'Recent transcript:',
      resumeTranscript,
    ].join('\n');
    return baseInstruction ? `${baseInstruction}\n\n${resumeInstruction}` : resumeInstruction;
  }

  function prepareVoiceResumeContext() {
    const transcript = buildVoiceResumeText();
    if (!transcript) return;
    try {
      localStorage.setItem(VOICE_RESUME_CONTEXT_KEY, JSON.stringify({
        createdAt: Date.now(),
        transcript,
      }));
    } catch {}
  }

  function continueVoiceConversation() {
    prepareVoiceResumeContext();
    openVoicePage();
  }

  function currentVoiceMessages() {
    loadVoiceSessions();
    const session = currentVoiceSession();
    if (!session) return [];
    if (!Array.isArray(session.messages)) session.messages = [];
    return session.messages;
  }

  function appendVoiceSessionMessage(role, textValue, options = {}) {
    const content = String(textValue || '').trim();
    if (!content) return null;
    const messagesList = currentVoiceMessages();
    const id = options.id || `voice_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const existing = messagesList.find((entry) => entry.id === id);
    if (existing) {
      existing.text = options.replace ? content : `${existing.text || ''}${content}`;
      existing.timestamp = Date.now();
    } else if (!isDuplicateVoiceSessionMessage(messagesList, role, content, id)) {
      messagesList.push({ id, role, text: content, partial: Boolean(options.partial), timestamp: Date.now() });
    }
    const session = currentVoiceSession();
    if (session) {
      session.title = createVoiceSessionTitle(messagesList);
      session.updatedAt = Date.now();
    }
    saveVoiceSessions();
    renderVoiceHistory();
    return id;
  }

  function createChatVoiceBubble(role, textValue) {
    hideEmpty();
    const wrapper = document.createElement('article');
    wrapper.className = `msg ${role}`;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = role === 'user' ? text('webui.chatkit.userLabel', '你') : 'Grok Voice';
    const card = document.createElement('div');
    card.className = `msg-card msg-card-${role}`;
    card.textContent = textValue || '';
    wrapper.appendChild(meta);
    wrapper.appendChild(card);
    thread.appendChild(wrapper);
    scrollThread();
    return { wrapper, card, text: textValue || '' };
  }

  function appendChatVoiceAssistant(delta, options = {}) {
    const content = String(delta || '');
    if (!content && !options.replace) return;
    if (!chatVoiceAssistantEntry || (!options.replace && options.key !== chatVoiceAssistantKey && chatVoiceAssistantEntry.text)) {
      chatVoiceAssistantEntry = createChatVoiceBubble('assistant', '');
    }
    chatVoiceAssistantKey = options.key || chatVoiceAssistantKey || `voice-assistant-${Date.now()}`;
    chatVoiceAssistantEntry.text = options.replace ? content : `${chatVoiceAssistantEntry.text || ''}${content}`;
    chatVoiceAssistantEntry.card.textContent = chatVoiceAssistantEntry.text;
    appendVoiceSessionMessage('assistant', options.replace ? chatVoiceAssistantEntry.text : content, {
      id: chatVoiceAssistantKey,
      replace: Boolean(options.replace),
      partial: !options.final,
    });
    scrollThread();
  }

  function decodeChatVoicePayload(payload) {
    try {
      const raw = typeof payload === 'string' ? payload : new TextDecoder('utf-8').decode(payload);
      const trimmed = raw.trim();
      if (!trimmed) return [];
      try { return [JSON.parse(trimmed)]; } catch {}
      return trimmed.split(/\n+/).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } catch {
      return [];
    }
  }

  function extractVoiceEventText(item) {
    if (!item || typeof item !== 'object') return '';
    if (typeof item.transcript === 'string') return item.transcript;
    if (typeof item.text === 'string') return item.text;
    if (Array.isArray(item.content)) {
      return item.content.map((part) => part?.transcript || part?.text || '').filter(Boolean).join('\n');
    }
    return '';
  }

  function normalizeChatVoiceSentText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function rememberChatVoiceSentText(value) {
    const key = normalizeChatVoiceSentText(value);
    if (!key) return;
    const expiresAt = Date.now() + 30000;
    chatVoiceRecentSentTexts.set(key, expiresAt);
    window.setTimeout(() => {
      if (chatVoiceRecentSentTexts.get(key) === expiresAt) chatVoiceRecentSentTexts.delete(key);
    }, 31000);
  }

  function isRecentChatVoiceSentText(value) {
    const key = normalizeChatVoiceSentText(value);
    if (!key) return false;
    const expiresAt = chatVoiceRecentSentTexts.get(key) || 0;
    if (expiresAt <= Date.now()) {
      chatVoiceRecentSentTexts.delete(key);
      return false;
    }
    return true;
  }

  function handleChatVoiceEvent(event) {
    const type = String(event?.type || '');
    if (!type || type === 'ping') return;
    if (type === 'conversation.item.created') {
      const item = event.item || {};
      const role = String(item.role || '').toLowerCase();
      const content = extractVoiceEventText(item).trim();
      if (role === 'user' && content && !isRecentChatVoiceSentText(content)) {
        createChatVoiceBubble('user', content);
        appendVoiceSessionMessage('user', content, { id: item.id || `voice-user-${Date.now()}` });
      }
      return;
    }
    if (type === 'response.output_item.added') {
      chatVoiceAssistantKey = event.item?.id || event.response_id || `voice-assistant-${Date.now()}`;
      chatVoiceAssistantEntry = createChatVoiceBubble('assistant', '');
      return;
    }
    if (type === 'response.audio_transcript.delta') {
      appendChatVoiceAssistant(event.delta || '', { key: event.item_id || event.response_id || chatVoiceAssistantKey });
      return;
    }
    if (type === 'response.audio_transcript.done') {
      const responseId = String(event.response_id || '').trim();
      appendChatVoiceAssistant(event.transcript || '', {
        key: event.item_id || responseId || chatVoiceAssistantKey,
        replace: Boolean(event.transcript),
        final: true,
      });
      if (responseId) chatVoiceCommittedResponseIds.add(responseId);
      return;
    }
    if (type === 'response.human_assist_turn.commit') {
      const responseId = String(event.response_id || '').trim();
      if (responseId && chatVoiceCommittedResponseIds.has(responseId)) return;
      const turn = event.human_assist_turn_response || {};
      const userText = String(turn.user?.transcript || '').trim();
      const assistantText = String(turn.assistant?.transcript || '').trim();
      if (userText) {
        if (!isDuplicateVoiceSessionMessage(currentVoiceMessages(), 'user', userText, `${responseId || Date.now()}:user`)) {
          appendVoiceSessionMessage('user', userText, { id: `${responseId || Date.now()}:user` });
        }
      }
      if (assistantText) {
        const assistantKey = chatVoiceAssistantEntry ? chatVoiceAssistantKey : (responseId || chatVoiceAssistantKey);
        appendChatVoiceAssistant(assistantText, {
          key: assistantKey,
          replace: true,
          final: true,
        });
      }
      if (responseId) chatVoiceCommittedResponseIds.add(responseId);
    }
  }

  function detachChatVoiceAudio() {
    chatVoiceAudioElements.forEach((node) => {
      try {
        node.pause();
        node.srcObject = null;
      } catch {}
      node.remove();
    });
    chatVoiceAudioElements.clear();
  }

  function addChatVoiceAudioTrack(track) {
    if (!track || track.kind !== 'audio' || typeof track.attach !== 'function') return;
    const element = track.attach();
    element.autoplay = true;
    element.playsInline = true;
    element.style.display = 'none';
    document.body.appendChild(element);
    chatVoiceAudioElements.add(element);
  }

  function bindChatVoiceRoomEvents(lk, currentRoom) {
    currentRoom.on(lk.RoomEvent.TrackSubscribed, addChatVoiceAudioTrack);
    currentRoom.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      try {
        track.detach().forEach((el) => {
          chatVoiceAudioElements.delete(el);
          el.remove();
        });
      } catch {}
    });
    if (lk.RoomEvent.DataReceived) {
      currentRoom.on(lk.RoomEvent.DataReceived, (payload) => {
        decodeChatVoicePayload(payload).forEach(handleChatVoiceEvent);
      });
    }
    currentRoom.on(lk.RoomEvent.Disconnected, () => {
      chatVoiceConnected = false;
      chatVoiceRoom = null;
      detachChatVoiceAudio();
      renderChatVoiceUi();
    });
  }

  function chatVoiceRemoteIdentities() {
    if (!chatVoiceRoom?.remoteParticipants || typeof chatVoiceRoom.remoteParticipants.values !== 'function') return [];
    return Array.from(chatVoiceRoom.remoteParticipants.values()).map((participant) => participant.identity).filter(Boolean);
  }

  async function waitForChatVoiceAgent(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (chatVoiceRemoteIdentities().length) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return chatVoiceRemoteIdentities().length > 0;
  }

  async function teardownChatVoiceSession(manual = false) {
    const currentRoom = chatVoiceRoom;
    chatVoiceRoom = null;
    chatVoiceConnected = false;
    chatVoiceConnecting = false;
    chatVoiceAssistantEntry = null;
    chatVoiceAssistantKey = '';
    try { if (currentRoom) await currentRoom.disconnect(); } catch {}
    detachChatVoiceAudio();
    renderChatVoiceUi();
    if (manual) setStatus(text('webui.chat.voiceEnded', 'Grok Voice 已结束'));
  }

  async function startChatVoiceSession() {
    if (chatVoiceConnected) return true;
    if (chatVoiceConnecting) return false;
    const lk = getLiveKit();
    if (!lk || !lk.Room) {
      toast(text('webui.chatkit.livekitLoadFailed', 'LiveKit SDK 加载失败'), 'error');
      return false;
    }
    persistChatVoicePreference();
    persistChatVoicePersonalityPreference();
    chatVoiceCommittedResponseIds = new Set();
    chatVoiceAssistantEntry = null;
    chatVoiceAssistantKey = '';
    chatVoiceConnecting = true;
    renderChatVoiceUi();
    setStatus(text('webui.chat.voiceConnecting', '正在连接 Grok Voice...'));
    try {
      if (lk.setLogLevel && lk.LogLevel) lk.setLogLevel(lk.LogLevel.error);
    } catch {}
    try {
      const headers = await getAuthHeaders();
      headers['Content-Type'] = 'application/json';
      const params = new URLSearchParams({
        voice: selectedChatVoiceId(),
        personality: selectedChatVoicePersonality(),
        speed: '1',
        instruction: buildChatVoiceInstruction(),
      });
      const res = await fetch(`${VOICE_ENDPOINT}?${params.toString()}`, { headers, cache: 'no-store' });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      if (!payload?.token || !payload?.url) throw new Error(text('webui.chatkit.invalidToken', 'Voice token response invalid'));
      const currentRoom = new lk.Room({
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      chatVoiceRoom = currentRoom;
      bindChatVoiceRoomEvents(lk, currentRoom);
      let micError = null;
      const micPromise = currentRoom.localParticipant.setMicrophoneEnabled(true).catch((error) => {
        micError = error;
        return null;
      });
      await currentRoom.connect(payload.url, payload.token);
      await micPromise;
      if (micError) throw micError;
      chatVoiceConnected = true;
      setStatus(text('webui.chat.voiceConnected', 'Grok Voice 已连接'));
      renderChatVoiceUi();
      return true;
    } catch (error) {
      await teardownChatVoiceSession(false);
      const message = error && error.message ? error.message : String(error);
      toast(message, 'error');
      setStatus(`${text('webui.chat.statusFailed', 'Failed')}: ${message}`);
      return false;
    } finally {
      chatVoiceConnecting = false;
      renderChatVoiceUi();
    }
  }

  async function sendChatVoiceText() {
    if (sending || chatVoiceSending) return;
    const prompt = (promptInput.value || '').trim();
    if (!prompt) {
      toast(text('webui.chat.errors.enterPrompt', 'Please enter a message'), 'error');
      return;
    }
    chatVoiceSending = true;
    try {
      if (!chatVoiceConnected && !await startChatVoiceSession()) return;
      const agentReady = await waitForChatVoiceAgent();
      if (!agentReady) {
        toast(text('webui.chatkit.agentNotReady', 'Grok Voice Agent 尚未就绪，请稍后再发送'), 'error');
        return;
      }
      chatVoiceLastSentText = prompt;
      rememberChatVoiceSentText(prompt);
      window.setTimeout(() => {
        if (chatVoiceLastSentText === prompt) chatVoiceLastSentText = '';
      }, 30000);
      createChatVoiceBubble('user', prompt);
      appendVoiceSessionMessage('user', prompt);
      promptInput.value = '';
      resizePromptInput();
      const payload = new TextEncoder().encode(prompt);
      const options = { reliable: true, topic: 'grok.chat' };
      await chatVoiceRoom.localParticipant.publishData(payload, options);
      setStatus(text('webui.chat.voiceSent', '已通过 Grok Voice 发送'));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      toast(message, 'error');
      setStatus(`${text('webui.chat.errors.requestFailed', 'Request failed')}: ${message}`);
    } finally {
      chatVoiceSending = false;
    }
  }

  async function restartChatVoiceSessionForVoiceChange() {
    persistChatVoicePreference();
    if (!chatVoiceConnected && !chatVoiceConnecting) return;
    prepareVoiceResumeContext();
    await teardownChatVoiceSession(false);
    await startChatVoiceSession();
  }

  function renderVoiceHistoryThread() {
    if (!thread) return;
    const history = loadVoiceHistory();
    showingVoiceHistory = true;
    currentSessionId = '';
    sessionListRenderSignature = '';
    renderSessionList();
    thread.innerHTML = '';
    hideEmpty();

    const header = document.createElement('section');
    header.className = 'webui-voice-history-thread-head';
    const title = document.createElement('div');
    title.className = 'webui-voice-history-thread-title';
    title.textContent = 'Voice History';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'webui-voice-history-thread-action';
    action.textContent = text('webui.chat.voiceHistoryContinue', '继续语音');
    action.addEventListener('click', continueVoiceConversation);
    header.appendChild(title);
    header.appendChild(action);
    thread.appendChild(header);

    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'webui-voice-history-thread-empty';
      empty.textContent = text('webui.chat.voiceHistoryEmpty', '暂无语音记录');
      thread.appendChild(empty);
      return;
    }

    history.forEach((entry) => {
      const wrapper = document.createElement('article');
      wrapper.className = `msg ${entry.role}`;
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const role = entry.role === 'user' ? text('webui.chatkit.userLabel', '你') : 'Grok';
      const timeValue = formatVoiceHistoryTime(entry.timestamp);
      meta.textContent = timeValue ? `${role} · ${timeValue}` : role;
      const card = document.createElement('div');
      card.className = 'msg-card';
      card.textContent = entry.text;
      wrapper.appendChild(meta);
      wrapper.appendChild(card);
      thread.appendChild(wrapper);
    });
    scrollThread();
  }

  function createSessionTitle(messagesList) {
    const firstUser = messagesList.find((item) => {
      if (!item || item.role !== 'user') return false;
      return Boolean(extractTextContent(item.content).trim());
    });
    if (!firstUser) return text('webui.chat.untitled', 'New Chat');
    const trimmed = extractTextContent(firstUser.content).trim().replace(/\s+/g, ' ');
    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
  }

  function createSession() {
    return {
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: text('webui.chat.untitled', 'New Chat'),
      titleLocked: false,
      model: modelSelect.value || PREFERRED_MODEL,
      system: '',
      messages: [],
      updatedAt: Date.now(),
    };
  }

  function normalizeSession(item) {
    return {
      id: item && item.id ? String(item.id) : `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: item && item.title ? String(item.title) : text('webui.chat.untitled', 'New Chat'),
      titleLocked: Boolean(item && item.titleLocked),
      model: item && item.model ? String(item.model) : PREFERRED_MODEL,
      system: item && item.system ? String(item.system) : '',
      messages: Array.isArray(item && item.messages)
        ? item.messages
          .filter((entry) => {
            if (!entry || typeof entry.role !== 'string') return false;
            if (!['user', 'assistant', 'error'].includes(entry.role)) return false;
            return typeof entry.content === 'string' || Array.isArray(entry.content);
          })
          .map((entry) => ({
            ...entry,
            reasoning_content: entry && entry.role === 'assistant' && hasVisibleReasoning(entry.reasoning_content)
              ? entry.reasoning_content
              : '',
            createdAt: Number(entry && entry.createdAt) || Date.now(),
            feedback: entry && typeof entry.feedback === 'string' ? entry.feedback : '',
            upstream_response_id: entry && entry.role === 'assistant' ? String(entry.upstream_response_id || '') : '',
            upstream_conversation_id: entry && entry.role === 'assistant' ? String(entry.upstream_conversation_id || '') : '',
          }))
        : [],
      updatedAt: Number(item && item.updatedAt) || Date.now(),
    };
  }

  function setAssistantFeedback(messageIndex, feedback) {
    const session = getCurrentSession();
    const message = session && session.messages && session.messages[messageIndex];
    if (!session || !message || message.role !== 'assistant') return;
    message.feedback = message.feedback === feedback ? '' : feedback;
    session.updatedAt = Date.now();
    persistStore();
    renderThread();
  }

  let currentReadAudio = null;
  let currentReadBtn = null;
  const READ_AUDIO_CACHE_LIMIT = 20;
  const readAudioCache = new Map();

  function normalizeReadVoiceId(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Ara';
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }

  function selectedReadVoiceId() {
    try {
      return normalizeReadVoiceId(localStorage.getItem(VOICE_PREF_KEY));
    } catch {
      return 'Ara';
    }
  }

  function readAudioCacheKey(responseId, voiceId) {
    return `${voiceId || 'Ara'}:${responseId}`;
  }

  function getCachedReadAudioUrl(key) {
    const url = readAudioCache.get(key);
    if (!url) return '';
    readAudioCache.delete(key);
    readAudioCache.set(key, url);
    return url;
  }

  function putCachedReadAudioUrl(key, url) {
    if (!key || !url) return;
    if (readAudioCache.has(key)) readAudioCache.delete(key);
    readAudioCache.set(key, url);
    while (readAudioCache.size > READ_AUDIO_CACHE_LIMIT) {
      const oldestKey = readAudioCache.keys().next().value;
      const oldestUrl = readAudioCache.get(oldestKey);
      readAudioCache.delete(oldestKey);
      try { URL.revokeObjectURL(oldestUrl); } catch {}
    }
  }

  function stopCurrentReadAudio() {
    if (currentReadAudio) {
      try { currentReadAudio.pause(); } catch {}
      currentReadAudio = null;
    }
    if (currentReadBtn) {
      currentReadBtn.classList.remove('playing');
      currentReadBtn = null;
    }
  }

  async function playOfficialReadAloud(entry, btn) {
    const responseId = String(entry && entry.upstreamResponseId || '').trim();
    if (!responseId) {
      toast(text(
        'webui.chat.readAloudUnavailable',
        'Read-aloud unavailable for this message (official Grok responseId is missing).'
      ), 'warn');
      return false;
    }

    const voiceId = selectedReadVoiceId();
    const params = new URLSearchParams({ voiceId });
    const conversationId = String(entry && entry.upstreamConversationId || '').trim();
    if (conversationId) params.set('conversationId', conversationId);

    const cacheKey = readAudioCacheKey(responseId, voiceId);
    let audioUrl = getCachedReadAudioUrl(cacheKey);
    if (!audioUrl) {
      const headers = await getAuthHeaders();
      const res = await fetch(`/webui/api/voice/read/${encodeURIComponent(responseId)}?${params.toString()}`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      if (!blob || !blob.size) {
        throw new Error('empty audio response');
      }
      audioUrl = URL.createObjectURL(blob);
      putCachedReadAudioUrl(cacheKey, audioUrl);
    }

    const audio = entry.audioPlayer || new Audio();
    audio.src = audioUrl;
    audio.controls = true;
    audio.hidden = false;
    try { audio.currentTime = 0; } catch {}
    audio.onended = () => {
      if (currentReadBtn === btn) stopCurrentReadAudio();
    };
    audio.onerror = () => {
      if (currentReadBtn === btn) stopCurrentReadAudio();
      toast(text('webui.chat.readAloudFailed', 'Read aloud failed. If this is an older message, regenerate it and try again.'), 'error');
    };

    btn.classList.add('playing');
    currentReadBtn = btn;
    currentReadAudio = audio;
    setStatus(text('webui.chat.readAloudPlaying', 'Playing audio...'));
    await audio.play();
    return true;
  }

  async function toggleReadAloud(entry, btn) {
    if (!entry) return;
    if (currentReadBtn === btn) {
      stopCurrentReadAudio();
      return;
    }
    stopCurrentReadAudio();

    try {
      await playOfficialReadAloud(entry, btn);
    } catch (error) {
      stopCurrentReadAudio();
      toast(`${text('webui.chat.readAloudFailed', 'Read aloud failed. If this is an older message, regenerate it and try again.')}: ${error.message || error}`, 'error');
      setStatus(text('webui.chat.statusDone', 'Completed'));
    }
  }

  function regenerateAssistantAt(messageIndex) {
    const session = getCurrentSession();
    if (!session || sending || messageIndex < 0) return;

    let userIndex = -1;
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      if (messages[index] && messages[index].role === 'user') {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;

    const userContent = messages[userIndex].content;
    promptInput.value = extractTextContent(userContent) || (typeof userContent === 'string' ? userContent : '');
    pendingFiles = extractEditablePendingFiles(userContent);
    messages = messages.slice(0, userIndex);
    session.messages = messages;
    session.updatedAt = Date.now();
    activeEdit = null;
    renderUploadMeta();
    renderSessionList();
    renderThread();
    resizePromptInput();
    void sendMessage();
  }

  function getCurrentSession() {
    return sessions.find((item) => item.id === currentSessionId) || null;
  }

  function moveSessionToTop(session) {
    sessions = [session, ...sessions.filter((item) => item.id !== session.id)];
  }

  async function getAuthHeaders() {
    const key = await webuiKey.get();
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  function getLiveKit() {
    return window.LiveKitClient || window.LivekitClient || null;
  }

  function normalizeVoiceId(value) {
    const raw = String(value || '').trim();
    const aliases = {
      ara: 'Ara',
      Ara: 'Ara',
      eve: 'eve',
      Eve: 'eve',
      leo: 'leo',
      Leo: 'leo',
      rex: 'Grok',
      Rex: 'Grok',
      grok: 'Grok',
      Grok: 'Grok',
      sal: 'xai_sal',
      Sal: 'xai_sal',
      xai_sal: 'xai_sal',
      gork: 'Gork',
      Gork: 'Gork',
    };
    return aliases[raw] || raw || 'Ara';
  }

  function selectedChatVoiceId() {
    return normalizeVoiceId(chatVoiceSelect?.value || localStorage.getItem(VOICE_PREF_KEY) || 'Ara');
  }

  function persistChatVoicePreference() {
    try { localStorage.setItem(VOICE_PREF_KEY, selectedChatVoiceId()); } catch {}
  }

  function restoreChatVoicePreference() {
    if (!chatVoiceSelect) return;
    try {
      const stored = normalizeVoiceId(localStorage.getItem(VOICE_PREF_KEY) || 'Ara');
      if (Array.from(chatVoiceSelect.options).some((option) => option.value === stored)) {
        chatVoiceSelect.value = stored;
      }
    } catch {}
  }

  function normalizeChatVoicePersonality(entry) {
    const id = String(entry?.id || '').trim();
    const name = String(entry?.name || '').trim();
    const instruction = String(entry?.instruction || '').trim();
    if (!id || !name || !instruction) return null;
    return { id, name, instruction };
  }

  function customChatVoicePersonalityValue(id) {
    return `${CUSTOM_PERSONALITY_PREFIX}${id}`;
  }

  function isCustomChatVoicePersonalityValue(value) {
    return String(value || '').startsWith(CUSTOM_PERSONALITY_PREFIX);
  }

  function selectedChatVoicePersonalityValue() {
    return String(chatVoicePersonalitySelect?.value || 'assistant').trim() || 'assistant';
  }

  function selectedChatVoiceCustomPersonalityId() {
    const value = selectedChatVoicePersonalityValue();
    return isCustomChatVoicePersonalityValue(value) ? value.slice(CUSTOM_PERSONALITY_PREFIX.length) : '';
  }

  function selectedChatVoiceCustomPersonality() {
    const id = selectedChatVoiceCustomPersonalityId();
    return chatVoiceCustomPersonalities.find((item) => item.id === id) || null;
  }

  function selectedChatVoicePersonality() {
    const value = selectedChatVoicePersonalityValue();
    return value === CUSTOM_NEW_VALUE || isCustomChatVoicePersonalityValue(value) ? 'assistant' : value;
  }

  function selectedChatVoiceCustomInstruction() {
    const saved = selectedChatVoiceCustomPersonality();
    if (saved) return saved.instruction;
    return String(chatVoiceInstructionInput?.value || '').trim();
  }

  function selectedChatVoiceCustomName() {
    const saved = selectedChatVoiceCustomPersonality();
    if (saved) return saved.name;
    return String(chatVoiceCustomPersonalityNameInput?.value || '').trim();
  }

  function loadChatVoiceCustomPersonalities() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_PERSONALITIES_KEY) || '[]');
      chatVoiceCustomPersonalities = Array.isArray(parsed)
        ? parsed.map(normalizeChatVoicePersonality).filter(Boolean)
        : [];
    } catch {
      chatVoiceCustomPersonalities = [];
    }
  }

  function saveChatVoiceCustomPersonalities() {
    try { localStorage.setItem(CUSTOM_PERSONALITIES_KEY, JSON.stringify(chatVoiceCustomPersonalities)); } catch {}
  }

  function createChatVoiceCustomPersonalityId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function persistChatVoiceCustomDraft() {
    try {
      localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({
        name: String(chatVoiceCustomPersonalityNameInput?.value || ''),
        instruction: String(chatVoiceInstructionInput?.value || ''),
      }));
    } catch {}
  }

  function restoreChatVoiceCustomDraft() {
    const saved = selectedChatVoiceCustomPersonality();
    if (saved) {
      if (chatVoiceCustomPersonalityNameInput) chatVoiceCustomPersonalityNameInput.value = saved.name;
      if (chatVoiceInstructionInput) chatVoiceInstructionInput.value = saved.instruction;
      return;
    }
    try {
      const draft = JSON.parse(localStorage.getItem(CUSTOM_DRAFT_KEY) || '{}');
      if (chatVoiceCustomPersonalityNameInput) chatVoiceCustomPersonalityNameInput.value = String(draft?.name || '');
      if (chatVoiceInstructionInput) chatVoiceInstructionInput.value = String(draft?.instruction || '');
    } catch {
      if (chatVoiceCustomPersonalityNameInput) chatVoiceCustomPersonalityNameInput.value = '';
      if (chatVoiceInstructionInput) chatVoiceInstructionInput.value = '';
    }
  }

  function renderChatVoicePersonalityOptions() {
    if (!chatVoicePersonalitySelect) return;
    chatVoicePersonalitySelect.querySelectorAll(`option[value^="${CUSTOM_PERSONALITY_PREFIX}"]`).forEach((option) => option.remove());
    chatVoiceCustomPersonalities.forEach((item) => {
      const anchor = chatVoicePersonalitySelect.querySelector(`option[value="${CUSTOM_NEW_VALUE}"]`);
      const option = document.createElement('option');
      option.value = customChatVoicePersonalityValue(item.id);
      option.textContent = item.name;
      if (anchor) chatVoicePersonalitySelect.insertBefore(option, anchor); else chatVoicePersonalitySelect.appendChild(option);
    });
  }

  function renderChatVoiceInstructionVisibility() {
    const enabled = Boolean(chatVoiceConnected);
    if (chatVoicePersonalityPanel) chatVoicePersonalityPanel.hidden = !enabled;
    if (chatVoiceInstructionPill) chatVoiceInstructionPill.hidden = true;
  }

  function persistChatVoicePersonalityPreference() {
    try { localStorage.setItem(PERSONALITY_PREF_KEY, String(chatVoicePersonalitySelect?.value || 'assistant')); } catch {}
  }

  function restoreChatVoicePersonalityPreference() {
    if (!chatVoicePersonalitySelect) return;
    try {
      const stored = String(localStorage.getItem(PERSONALITY_PREF_KEY) || '').trim();
      if (stored && Array.from(chatVoicePersonalitySelect.options).some((option) => option.value === stored)) {
        chatVoicePersonalitySelect.value = stored;
      }
    } catch {}
    renderChatVoiceInstructionVisibility();
  }

  function saveSelectedChatVoiceCustomPersonality() {
    const name = selectedChatVoiceCustomName();
    const instruction = String(chatVoiceInstructionInput?.value || '').trim();
    if (!name || !instruction) {
      toast('请先填写个性名称和 Instruction', 'error');
      return;
    }
    const currentId = selectedChatVoiceCustomPersonalityId();
    const id = currentId || createChatVoiceCustomPersonalityId();
    const next = { id, name, instruction };
    const index = chatVoiceCustomPersonalities.findIndex((item) => item.id === id);
    if (index >= 0) chatVoiceCustomPersonalities[index] = next;
    else chatVoiceCustomPersonalities.push(next);
    saveChatVoiceCustomPersonalities();
    renderChatVoicePersonalityOptions();
    if (chatVoicePersonalitySelect) chatVoicePersonalitySelect.value = customChatVoicePersonalityValue(id);
    persistChatVoicePersonalityPreference();
    renderChatVoiceInstructionVisibility();
  }

  function deleteSelectedChatVoiceCustomPersonality() {
    const selected = selectedChatVoiceCustomPersonality();
    if (!selected) return;
    chatVoiceCustomPersonalities = chatVoiceCustomPersonalities.filter((item) => item.id !== selected.id);
    saveChatVoiceCustomPersonalities();
    renderChatVoicePersonalityOptions();
    if (chatVoicePersonalitySelect) chatVoicePersonalitySelect.value = 'assistant';
    persistChatVoicePersonalityPreference();
    renderChatVoiceInstructionVisibility();
  }

  async function ensureAccess() {
    const stored = await webuiKey.get();
    if (stored && await verifyKey(VERIFY_ENDPOINT, stored)) return true;
    if (stored) webuiKey.clear();
    if (await verifyKey(VERIFY_ENDPOINT, '')) return true;
    location.href = '/webui/login';
    return false;
  }

  function setStatus(textValue) {
    if (statusEl) statusEl.textContent = textValue;
  }

  function resizePromptInput() {
    if (!promptInput) return;
    promptInput.style.height = `${PROMPT_MIN_HEIGHT}px`;
    const nextHeight = Math.min(Math.max(promptInput.scrollHeight, PROMPT_MIN_HEIGHT), PROMPT_MAX_HEIGHT);
    promptInput.style.height = `${nextHeight}px`;
    promptInput.style.overflowY = promptInput.scrollHeight > PROMPT_MAX_HEIGHT ? 'auto' : 'hidden';
  }

  function renderSendButton() {
    if (!sendBtn) return;
    const label = sending
      ? text('webui.chat.stop', 'Stop')
      : text('webui.chat.send', 'Send');
    sendBtn.removeAttribute('data-i18n');
    sendBtn.setAttribute('aria-label', label);
    sendBtn.setAttribute('title', label);
    sendBtn.innerHTML = sending
      ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 8H16V16H8Z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12H19"/><path d="M13 6L19 12L13 18"/></svg>';
  }

  function renderChatVoiceUi() {
    inputShell?.classList.toggle('is-voice-mode', chatVoiceConnected);
    if (chatVoiceBtn) {
      chatVoiceBtn.classList.toggle('is-live', chatVoiceConnected);
      chatVoiceBtn.classList.toggle('is-connecting', chatVoiceConnecting);
      chatVoiceBtn.disabled = chatVoiceConnecting;
      const label = chatVoiceConnected
        ? text('webui.chat.voiceDisconnect', '结束 Grok Voice')
        : text('webui.chat.voiceConnect', '连接 Grok Voice');
      chatVoiceBtn.setAttribute('aria-label', label);
      chatVoiceBtn.setAttribute('title', label);
    }
    if (promptInput && !sending) {
      promptInput.placeholder = chatVoiceConnected
        ? '输入文本，Grok 将以语音回复；也可直接说话'
        : text('webui.chat.promptPlaceholder', '输入你的问题，Enter 发送，Shift+Enter 换行');
    }
    renderChatVoiceInstructionVisibility();
  }

  function setSending(next) {
    sending = next;
    promptInput.disabled = next;
    modelSelect.disabled = next;
    if (systemInput) systemInput.disabled = next;
    renderSendButton();
  }

  function scrollThread() {
    if (pendingThreadScrollFrame) return;
    pendingThreadScrollFrame = window.requestAnimationFrame(() => {
      pendingThreadScrollFrame = 0;
      thread.scrollTop = thread.scrollHeight;
    });
  }

  function hideEmpty() {
    if (emptyState) emptyState.style.display = 'none';
  }

  function showEmpty() {
    if (emptyState) emptyState.style.display = '';
  }

  function renderUploadMeta() {
    if (!uploadMeta) return;
    if (!pendingFiles.length) {
      uploadMeta.hidden = true;
      uploadMeta.replaceChildren();
      return;
    }

    const row = document.createElement('div');
    row.className = 'webui-upload-meta-row';

    pendingFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'webui-upload-meta-chip';
      chip.title = file.name || 'file';
      const chars = Array.from(String(file.name || 'file'));

      const label = document.createElement('span');
      label.className = 'webui-upload-meta-chip-label';
      label.textContent = chars.length > 5 ? `${chars.slice(0, 5).join('')}...` : (file.name || 'file');
      chip.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'webui-upload-meta-chip-remove';
      removeBtn.setAttribute('aria-label', `删除 ${file.name || 'file'}`);
      removeBtn.setAttribute('title', `删除 ${file.name || 'file'}`);
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      removeBtn.addEventListener('click', () => {
        pendingFiles = pendingFiles.filter((_, itemIndex) => itemIndex !== index);
        if (fileInput && !pendingFiles.length) fileInput.value = '';
        renderUploadMeta();
      });
      chip.appendChild(removeBtn);

      row.appendChild(chip);
    });

    uploadMeta.hidden = false;
    uploadMeta.replaceChildren(row);
  }

  function currentModelCapability() {
    const selected = modelSelect && modelSelect.value
      ? availableModels.find((item) => item && item.id === modelSelect.value)
      : null;
    return selected && selected.capability ? selected.capability : 'chat';
  }

  function currentModelMetadata() {
    const session = getCurrentSession();
    const modelId = String((session && session.model) || (modelSelect && modelSelect.value) || PREFERRED_MODEL).trim();
    return availableModels.find((item) => item && item.id === modelId) || null;
  }

  function supportsReadAloudForModel(model) {
    return Boolean(model && model.route !== 'console');
  }

  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('file read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function preparePendingFiles(fileList) {
    const files = Array.from(fileList || []);
    const prepared = [];

    for (const file of files) {
      if (!file) continue;
      prepared.push({
        name: file.name || 'file',
        type: file.type || 'application/octet-stream',
        size: Number(file.size) || 0,
        dataUrl: await fileToDataUrl(file),
      });
    }

    return prepared;
  }

  function buildUserMessage(prompt, capability) {
    const textBlock = prompt ? [{ type: 'text', text: prompt }] : [];
    const imageFiles = pendingFiles.filter((file) => (file.type || '').startsWith('image/'));
    const audioFiles = pendingFiles.filter((file) => (file.type || '').startsWith('audio/'));
    const otherFiles = pendingFiles.filter((file) => {
      const mime = file.type || '';
      return !mime.startsWith('image/') && !mime.startsWith('audio/');
    });

    const imageBlocks = imageFiles.map((file) => ({
      type: 'image_url',
      image_url: { url: file.dataUrl },
    }));
    const audioBlocks = audioFiles.map((file) => ({
      type: 'input_audio',
      input_audio: {
        data: file.dataUrl,
        filename: file.name,
      },
    }));
    const fileBlocks = otherFiles.map((file) => ({
      type: 'file',
      file: {
        file_data: file.dataUrl,
        filename: file.name,
      },
    }));

    if (capability === 'image') {
      if (pendingFiles.length) {
        throw new Error(text(
          'webui.chat.errors.imageUploadsNotSupported',
          'Image generation does not accept uploaded references here. Use chat, image edit, or video with a reference image.',
        ));
      }
      return { role: 'user', content: prompt };
    }
    if (capability === 'image_edit') {
      if (!imageBlocks.length) {
        throw new Error(text('webui.chat.errors.imageRequired', 'Image edit requires at least one reference image'));
      }
      if (audioBlocks.length || fileBlocks.length) {
        throw new Error(text('webui.chat.errors.imageOnly', 'Image edit only supports image uploads'));
      }
      return { role: 'user', content: [...textBlock, ...imageBlocks] };
    }
    if (capability === 'video') {
      if (audioBlocks.length || fileBlocks.length) {
        throw new Error(text('webui.chat.errors.videoImageOnly', 'Video generation only supports image reference uploads'));
      }
      return imageBlocks.length
        ? { role: 'user', content: [...textBlock, imageBlocks[0]] }
        : { role: 'user', content: prompt };
    }
    if (imageBlocks.length || audioBlocks.length || fileBlocks.length) {
      return { role: 'user', content: [...textBlock, ...imageBlocks, ...audioBlocks, ...fileBlocks] };
    }
    return { role: 'user', content: prompt };
  }

  function closeSessionModal(result) {
    if (!sessionModal) return;
    sessionModal.classList.remove('open');
    sessionModal.setAttribute('aria-hidden', 'true');
    const resolver = modalResolver;
    modalResolver = null;
    if (resolver) resolver(result);
  }

  function openSessionModal({ title, description = '', confirmLabel, cancelLabel, inputValue = '', withInput = false }) {
    if (!sessionModal) return Promise.resolve(null);
    sessionModalTitle.textContent = title;
    sessionModalDesc.textContent = description;
    sessionModalInputWrap.hidden = !withInput;
    sessionModalInput.value = withInput ? inputValue : '';
    sessionModalCancel.textContent = cancelLabel || text('webui.chat.cancel', 'Cancel');
    sessionModalConfirm.textContent = confirmLabel || text('webui.chat.confirm', 'Confirm');
    sessionModal.classList.add('open');
    sessionModal.setAttribute('aria-hidden', 'false');
    if (withInput) {
      setTimeout(() => {
        sessionModalInput.focus();
        sessionModalInput.select();
      }, 0);
    }
    return new Promise((resolve) => {
      modalResolver = resolve;
    });
  }

  function editMessageAt(messageIndex, content) {
    const session = getCurrentSession();
    if (!session || messageIndex < 0) return;
    if (sending) stopMessage();

    promptInput.value = activeEdit ? activeEdit.text : (extractTextContent(content) || (typeof content === 'string' ? content : ''));
    pendingFiles = activeEdit ? activeEdit.files.slice() : extractEditablePendingFiles(content);
    messages = messages.slice(0, messageIndex);
    session.messages = messages;
    session.model = modelSelect.value || PREFERRED_MODEL;
    session.system = currentSystemPrompt();
    if (!session.titleLocked) session.title = createSessionTitle(session.messages);
    session.updatedAt = Date.now();
    activeEdit = null;
    moveSessionToTop(session);
    renderUploadMeta();
    renderSessionList();
    renderThread();
    resizePromptInput();
    setStatus(text('webui.chat.statusReady', 'Ready'));
    persistStore();
    promptInput.focus();
  }

  function createMessage(role, initialText = '', initialReasoning = '', messageIndex = -1) {
    hideEmpty();
    const hasReasoning = role === 'assistant' && hasVisibleReasoning(initialReasoning);
    const isAssistantWaiting = role === 'assistant' && messageIndex < 0 && !hasReasoning && !hasMessageContent(initialText);

    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;

    const reasoning = document.createElement('div');
    reasoning.className = 'msg-reasoning';
    reasoning.hidden = !hasReasoning;

    const reasoningToggle = document.createElement('button');
    reasoningToggle.type = 'button';
    reasoningToggle.className = 'msg-reasoning-toggle';
    reasoningToggle.setAttribute('aria-expanded', 'true');
    reasoningToggle.innerHTML = `<span class="msg-reasoning-label">${escapeHtml(text('webui.chat.reasoning', 'Reasoning'))}</span><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6.5 8 10l4-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const reasoningBody = document.createElement('div');
    reasoningBody.className = 'msg-reasoning-body';
    reasoningBody.textContent = hasReasoning ? initialReasoning : '';

    reasoningToggle.addEventListener('click', () => {
      const collapsed = reasoning.classList.toggle('is-collapsed');
      reasoningToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });

    reasoning.appendChild(reasoningToggle);
    reasoning.appendChild(reasoningBody);

    const card = document.createElement('div');
    card.className = `msg-card msg-card-${role}`;
    const isEditing = role === 'user' && activeEdit && activeEdit.messageIndex === messageIndex;
    if (isEditing) {
      card.classList.add('msg-card-editing');

      const editor = document.createElement('textarea');
      editor.className = 'msg-edit-textarea';
      editor.value = activeEdit.text;
      editor.placeholder = text('webui.chat.editPlaceholder', 'Edit message');
      editor.addEventListener('input', () => {
        if (!activeEdit || activeEdit.messageIndex !== messageIndex) return;
        activeEdit.text = editor.value;
        editor.style.height = 'auto';
        editor.style.height = `${Math.max(editor.scrollHeight, 52)}px`;
      });
      editor.style.height = 'auto';
      editor.style.height = `${Math.max(editor.scrollHeight, 52)}px`;

      const footer = document.createElement('div');
      footer.className = 'msg-edit-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'msg-edit-cancel';
      cancelBtn.textContent = text('webui.chat.cancel', 'Cancel');
      cancelBtn.addEventListener('click', () => {
        activeEdit = null;
        renderThread();
      });

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'msg-edit-save';
      saveBtn.textContent = text('webui.chat.save', 'Save');
      saveBtn.addEventListener('click', () => {
        editMessageAt(messageIndex, initialText);
      });

      footer.appendChild(cancelBtn);
      footer.appendChild(saveBtn);
      card.appendChild(editor);
      card.appendChild(footer);

      setTimeout(() => {
        editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }, 0);
    } else if (isAssistantWaiting) {
      renderAssistantWaiting(card);
    } else {
      renderMessageContent(card, role, initialText);
    }

    const entry = {
      wrap,
      reasoning,
      reasoningBody,
      card,
      text: initialText,
      reasoningText: initialReasoning,
      waiting: isAssistantWaiting,
      messageIndex,
      upstreamResponseId: '',
      upstreamConversationId: '',
      actions: null,
      likeBtn: null,
      dislikeBtn: null,
      renderFrame: 0,
    };

    if (role === 'assistant') {
      wrap.appendChild(reasoning);
    }
    wrap.appendChild(card);

    if (role === 'user') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'msg-action-btn';
      editBtn.setAttribute('aria-label', text('webui.chat.edit', 'Edit'));
      editBtn.setAttribute('title', text('webui.chat.edit', 'Edit'));
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12.5 7.5 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      editBtn.addEventListener('click', () => {
        beginEditMessage(messageIndex, initialText);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'msg-action-btn';
      copyBtn.setAttribute('aria-label', text('webui.chat.copy', 'Copy'));
      copyBtn.setAttribute('title', text('webui.chat.copy', 'Copy'));
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M15 9V8a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      copyBtn.addEventListener('click', async () => {
        try {
          await copyToClipboard(extractTextContent(initialText) || (typeof initialText === 'string' ? initialText : ''));
          toast(text('webui.chat.copySuccess', 'Copied'), 'info');
        } catch (error) {
          toast(error.message || String(error), 'error');
        }
      });

      if (!isEditing) {
        actions.appendChild(editBtn);
        actions.appendChild(copyBtn);
        wrap.appendChild(actions);
      }
    }

    if (role === 'assistant') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions msg-actions-assistant';
      actions.hidden = messageIndex < 0;
      const message = messageIndex >= 0 ? messages[messageIndex] : null;

      const right = document.createElement('div');
      right.className = 'msg-action-group';

      const regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.className = 'msg-action-btn msg-action-btn-regen';
      regenBtn.setAttribute('aria-label', text('webui.chat.regenerate', 'Regenerate'));
      regenBtn.setAttribute('title', text('webui.chat.regenerate', 'Regenerate'));
      regenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 2v6h-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11a9 9 0 0 1 15.3-6.3L21 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 22v-6h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 13a9 9 0 0 1-15.3 6.3L3 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      regenBtn.addEventListener('click', () => {
        regenerateAssistantAt(entry.messageIndex);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'msg-action-btn';
      copyBtn.setAttribute('aria-label', text('webui.chat.copy', 'Copy'));
      copyBtn.setAttribute('title', text('webui.chat.copy', 'Copy'));
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M15 9V8a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      copyBtn.addEventListener('click', async () => {
        try {
          await copyToClipboard(typeof entry.text === 'string' ? entry.text : extractTextContent(entry.text));
          toast(text('webui.chat.copySuccess', 'Copied'), 'info');
        } catch (error) {
          toast(error.message || String(error), 'error');
        }
      });

      const likeBtn = document.createElement('button');
      likeBtn.type = 'button';
      likeBtn.className = `msg-action-btn${message && message.feedback === 'up' ? ' active' : ''}`;
      likeBtn.setAttribute('aria-label', text('webui.chat.like', 'Like'));
      likeBtn.setAttribute('title', text('webui.chat.like', 'Like'));
      likeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 11.5v7.5M10.5 19h6.1a1.8 1.8 0 0 0 1.76-1.44l1.12-5.6A1.8 1.8 0 0 0 17.72 10H14V6.9a1.7 1.7 0 0 0-3.12-.93L7 11.5v7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      likeBtn.addEventListener('click', () => {
        setAssistantFeedback(entry.messageIndex, 'up');
      });

      const dislikeBtn = document.createElement('button');
      dislikeBtn.type = 'button';
      dislikeBtn.className = `msg-action-btn${message && message.feedback === 'down' ? ' active' : ''}`;
      dislikeBtn.setAttribute('aria-label', text('webui.chat.dislike', 'Dislike'));
      dislikeBtn.setAttribute('title', text('webui.chat.dislike', 'Dislike'));
      dislikeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 12.5V5M10.5 5h6.1a1.8 1.8 0 0 1 1.76 1.44l1.12 5.6A1.8 1.8 0 0 1 17.72 14H14v3.1a1.7 1.7 0 0 1-3.12.93L7 12.5V5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      dislikeBtn.addEventListener('click', () => {
        setAssistantFeedback(entry.messageIndex, 'down');
      });

      const audioPlayer = document.createElement('audio');
      audioPlayer.className = 'msg-audio-player';
      audioPlayer.controls = true;
      audioPlayer.preload = 'none';
      audioPlayer.hidden = true;

      const speakBtn = document.createElement('button');
      speakBtn.type = 'button';
      speakBtn.className = 'msg-action-btn msg-action-btn-speak';
      speakBtn.setAttribute('aria-label', text('webui.chat.readAloud', 'Read aloud'));
      speakBtn.setAttribute('title', text('webui.chat.readAloud', 'Read aloud'));
      speakBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      speakBtn.addEventListener('click', () => {
        toggleReadAloud(entry, speakBtn);
      });

      right.appendChild(regenBtn);
      right.appendChild(copyBtn);
      right.appendChild(likeBtn);
      right.appendChild(dislikeBtn);
      right.appendChild(speakBtn);
      actions.appendChild(right);
      wrap.appendChild(actions);
      wrap.appendChild(audioPlayer);
      entry.actions = actions;
      entry.likeBtn = likeBtn;
      entry.dislikeBtn = dislikeBtn;
      entry.speakBtn = speakBtn;
      entry.audioPlayer = audioPlayer;
    }

    thread.appendChild(wrap);

    syncAssistantActions(entry);
    return entry;
  }

  function syncAssistantActions(entry) {
    if (!entry || !entry.actions) return;
    entry.actions.hidden = entry.messageIndex < 0;
    const message = entry.messageIndex >= 0 ? messages[entry.messageIndex] : null;
    if (entry.likeBtn) entry.likeBtn.classList.toggle('active', Boolean(message && message.feedback === 'up'));
    if (entry.dislikeBtn) entry.dislikeBtn.classList.toggle('active', Boolean(message && message.feedback === 'down'));
    if (entry.speakBtn) {
      const canReadAloud = READ_ALOUD_ENABLED
        && supportsReadAloudForModel(currentModelMetadata())
        && Boolean(String(entry.upstreamResponseId || '').trim());
      entry.speakBtn.hidden = !canReadAloud;
      entry.speakBtn.disabled = !canReadAloud;
      entry.speakBtn.setAttribute('aria-hidden', canReadAloud ? 'false' : 'true');
      entry.speakBtn.setAttribute(
        'title',
        canReadAloud
          ? text('webui.chat.readAloud', 'Read aloud')
          : text('webui.chat.readAloudUnavailable', 'Read-aloud unavailable for this model')
      );
    }
  }

  function renderAssistantEntry(entry) {
    if (!entry) return;
    entry.renderFrame = 0;
    if (entry.waiting) return;
    if (hasMessageContent(entry.text)) {
      renderMessageContent(entry.card, 'assistant', entry.text);
    } else {
      entry.card.innerHTML = '';
    }
    const hasReasoning = hasVisibleReasoning(entry.reasoningText);
    entry.reasoning.hidden = !hasReasoning;
    entry.reasoningBody.textContent = hasReasoning ? entry.reasoningText : '';
  }

  function scheduleAssistantEntryRender(entry) {
    if (!entry) return;
    if (!entry.renderFrame) {
      entry.renderFrame = window.requestAnimationFrame(() => {
        renderAssistantEntry(entry);
        scrollThread();
      });
    } else {
      scrollThread();
    }
  }

  function flushAssistantEntry(entry) {
    if (!entry) return;
    if (entry.renderFrame) {
      window.cancelAnimationFrame(entry.renderFrame);
      entry.renderFrame = 0;
    }
    renderAssistantEntry(entry);
  }

  function finalizeAssistantEntry(entry, messageIndex) {
    if (!entry) return;
    entry.waiting = false;
    flushAssistantEntry(entry);
    entry.messageIndex = messageIndex;
    syncAssistantActions(entry);
    scrollThread();
  }

  function updateAssistant(entry, delta) {
    if (entry.waiting) entry.waiting = false;
    entry.text += delta;
    scheduleAssistantEntryRender(entry);
  }

  function updateReasoning(entry, delta) {
    if (entry.waiting) entry.waiting = false;
    entry.reasoningText += delta;
    scheduleAssistantEntryRender(entry);
  }

  function renderThread() {
    thread.innerHTML = '';
    if (emptyState) thread.appendChild(emptyState);
    if (!messages.length) {
      showEmpty();
      return;
    }
    hideEmpty();
    messages.forEach((message, index) => {
      const entry = createMessage(
        message.role,
        message.content,
        message.role === 'assistant' ? (message.reasoning_content || '') : '',
        index,
      );
      if (entry && message.role === 'assistant') {
        entry.upstreamResponseId = message.upstream_response_id || '';
        entry.upstreamConversationId = message.upstream_conversation_id || '';
        syncAssistantActions(entry);
      }
    });
    scrollThread();
  }

  function renderSessionList() {
    if (!sessionList) return;
    sessionList.dataset.empty = text('webui.chat.noSessions', 'No chats yet');
    const nextSignature = `${currentSessionId}|${sessions.map((session) => `${session.id}:${session.title || ''}`).join('|')}`;
    if (nextSignature === sessionListRenderSignature) return;
    sessionListRenderSignature = nextSignature;
    const fragment = document.createDocumentFragment();

    sessions.forEach((session) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `webui-session-item${session.id === currentSessionId ? ' active' : ''}`;

      const title = document.createElement('div');
      title.className = 'webui-session-title';
      title.textContent = session.title || text('webui.chat.untitled', 'New Chat');
      const actions = document.createElement('div');
      actions.className = 'webui-session-actions';

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'webui-session-action';
      renameBtn.title = text('webui.chat.rename', 'Rename');
      renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12.5 7.5 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      renameBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        renameSession(session.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'webui-session-action';
      deleteBtn.title = text('webui.chat.delete', 'Delete');
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteSession(session.id);
      });

      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(title);
      item.appendChild(actions);
      item.addEventListener('click', () => switchSession(session.id));
      fragment.appendChild(item);
    });
    sessionList.replaceChildren(fragment);
  }

  function syncCurrentSession() {
    const session = getCurrentSession();
    if (!session) return;
    session.model = modelSelect.value || PREFERRED_MODEL;
    session.system = currentSystemPrompt();
    if (!session.titleLocked) session.title = createSessionTitle(session.messages);
    session.updatedAt = Date.now();
    moveSessionToTop(session);
    persistStore();
    renderSessionList();
  }

  function switchSession(id) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    showingVoiceHistory = false;
    currentSessionId = session.id;
    messages = session.messages;
    pendingFiles = [];
    activeEdit = null;
    if (modelSelect.options.length) {
      modelSelect.value = Array.from(modelSelect.options).some((option) => option.value === session.model)
        ? session.model
        : (modelSelect.value || PREFERRED_MODEL);
    }
    renderUploadMeta();
    renderSessionList();
    renderThread();
    resizePromptInput();
    setStatus(text('webui.chat.statusReady', 'Ready'));
    persistStore();
  }

  function startNewSession() {
    const session = createSession();
    showingVoiceHistory = false;
    sessions.unshift(session);
    currentSessionId = session.id;
    messages = session.messages;
    pendingFiles = [];
    activeEdit = null;
    renderUploadMeta();
    renderSessionList();
    renderThread();
    resizePromptInput();
    setStatus(text('webui.chat.statusReady', 'Ready'));
    persistStore();
    promptInput.focus();
  }

  function renameSession(id) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    openSessionModal({
      title: text('webui.chat.rename', 'Rename'),
      description: text('webui.chat.renamePrompt', 'Rename session'),
      confirmLabel: text('webui.chat.confirm', 'Confirm'),
      cancelLabel: text('webui.chat.cancel', 'Cancel'),
      inputValue: session.title || text('webui.chat.untitled', 'New Chat'),
      withInput: true,
    }).then((nextTitle) => {
      if (typeof nextTitle !== 'string') return;
      const trimmed = nextTitle.trim();
      if (!trimmed) return;
      session.title = trimmed;
      session.titleLocked = true;
      session.updatedAt = Date.now();
      moveSessionToTop(session);
      persistStore();
      renderSessionList();
    });
  }

  function deleteSession(id) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    openSessionModal({
      title: text('webui.chat.delete', 'Delete'),
      description: text('webui.chat.deleteConfirm', 'Delete this session?'),
      confirmLabel: text('webui.chat.delete', 'Delete'),
      cancelLabel: text('webui.chat.cancel', 'Cancel'),
    }).then((confirmed) => {
      if (!confirmed) return;
      sessions = sessions.filter((item) => item.id !== id);
      if (!sessions.length) {
        startNewSession();
        return;
      }

      const next = sessions[0];
      currentSessionId = next.id;
      persistStore();
      switchSession(next.id);
    });
  }

  function buildPayload() {
    const outgoing = [];
    const system = currentSystemPrompt();
    if (system) outgoing.push({ role: 'system', content: system });
    messages
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
      .forEach((message) => outgoing.push(message));
    return {
      model: modelSelect.value || PREFERRED_MODEL,
      messages: outgoing,
      stream: true,
      temperature: 0.8,
      top_p: 0.95,
      metadata: {
        webui_session_id: currentSessionId || '',
      },
    };
  }

  async function loadModels() {
    const headers = await getAuthHeaders();
    const res = await fetch(MODELS_ENDPOINT, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error(`models ${res.status}`);

    const data = await res.json();
    const items = Array.isArray(data && data.data) ? data.data : [];
    availableModels = items.filter((item) => item && item.id);
    const ids = items.map((item) => item && item.id).filter(Boolean);

    modelSelect.innerHTML = '';
    availableModels.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      const badge = modelRouteBadge(item);
      const label = formatModelOptionLabel(item.id, item.name || item.id);
      opt.textContent = badge ? `${label} · ${badge}` : label;
      opt.dataset.route = item.route || '';
      modelSelect.appendChild(opt);
    });
    modelSelect.value = ids.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : (ids[0] || PREFERRED_MODEL);
  }

  async function sendMessage() {
    if (sending) return;

    const prompt = (promptInput.value || '').trim();
    const capability = currentModelCapability();
    if (!prompt) {
      toast(text('webui.chat.errors.enterPrompt', 'Please enter a message'), 'error');
      return;
    }

    const session = getCurrentSession();
    if (!session) return;
    activeEdit = null;

    let userMessage;
    try {
      userMessage = buildUserMessage(prompt, capability);
    } catch (error) {
      toast(error.message || String(error), 'error');
      return;
    }

    session.model = modelSelect.value || PREFERRED_MODEL;
    session.system = currentSystemPrompt();
    messages.push(userMessage);
    if (!session.titleLocked) session.title = createSessionTitle(messages);
    session.updatedAt = Date.now();
    moveSessionToTop(session);
    persistStore();
    renderSessionList();

    messages[messages.length - 1].createdAt = Date.now();
    messages[messages.length - 1].feedback = '';
    const userEntry = createMessage('user', userMessage.content, '', messages.length - 1);
    void userEntry;
    const assistantCreatedAt = Date.now();
    const assistantEntry = createMessage('assistant', '', '', -1);

    promptInput.value = '';
    pendingFiles = [];
    if (fileInput) fileInput.value = '';
    renderUploadMeta();
    resizePromptInput();
    abortController = new AbortController();
    setSending(true);
    setStatus(text('webui.chat.statusConnecting', 'Connecting...'));

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders()),
      };
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildPayload()),
        signal: abortController.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      function finalizeStreamSuccess() {
        const finalReasoning = hasVisibleReasoning(assistantEntry.reasoningText) ? assistantEntry.reasoningText : '';
        messages.push({
          role: 'assistant',
          content: assistantEntry.text,
          reasoning_content: finalReasoning,
          createdAt: assistantCreatedAt,
          feedback: '',
          upstream_response_id: assistantEntry.upstreamResponseId || '',
          upstream_conversation_id: assistantEntry.upstreamConversationId || '',
        });
        syncCurrentSession();
        finalizeAssistantEntry(assistantEntry, messages.length - 1);
        setStatus(text('webui.chat.statusDone', 'Completed'));
      }

      function handleStreamChunk(chunk) {
        const messageEvent = parseSseEvent(chunk);
        const event = messageEvent.event || 'message';
        const payload = messageEvent.data.trim();
        if (!payload) return false;

        // Legacy Chat-Completions sentinel — keep so a switch back doesn't break.
        if (payload === '[DONE]') {
          finalizeStreamSuccess();
          return true;
        }

        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          return false;
        }

        const eventType = event !== 'message' ? event : (json && json.type) || '';

        // Hard error frames from upstream.
        if (eventType === 'error' || eventType === 'response.failed' || eventType === 'response.error' || json.error) {
          const errPayload = json.error || (json.response && json.response.error) || {};
          const errorMessage = (errPayload && errPayload.message)
            || (errPayload && errPayload.code)
            || text('webui.chat.errors.requestFailed', 'Request failed');
          throw new Error(errorMessage);
        }

        // Capture upstream Grok IDs that the chat.py path attaches (still surfaced
        // on the final response object when routed through grok.com).
        const respPart = json && json.response;
        if (respPart && typeof respPart === 'object') {
          if (typeof respPart.upstream_response_id === 'string' && respPart.upstream_response_id) {
            assistantEntry.upstreamResponseId = respPart.upstream_response_id;
          }
          if (typeof respPart.upstream_conversation_id === 'string' && respPart.upstream_conversation_id) {
            assistantEntry.upstreamConversationId = respPart.upstream_conversation_id;
          }
        }
        if (typeof json.upstream_response_id === 'string' && json.upstream_response_id) {
          assistantEntry.upstreamResponseId = json.upstream_response_id;
        }
        if (typeof json.upstream_conversation_id === 'string' && json.upstream_conversation_id) {
          assistantEntry.upstreamConversationId = json.upstream_conversation_id;
        }
        syncAssistantActions(assistantEntry);

        // Responses API streaming events.
        if (eventType === 'response.output_text.delta') {
          const delta = typeof json.delta === 'string' ? json.delta : '';
          if (delta) {
            updateAssistant(assistantEntry, delta);
            setStatus(text('webui.chat.statusGenerating', 'Generating...'));
          }
          return false;
        }

        if (
          eventType === 'response.reasoning_summary_text.delta' ||
          eventType === 'response.reasoning_summary.delta' ||
          eventType === 'response.reasoning.delta'
        ) {
          const delta = typeof json.delta === 'string' ? json.delta : '';
          if (delta) {
            updateReasoning(assistantEntry, delta);
            if (hasVisibleReasoning(assistantEntry.reasoningText)) {
              setStatus(text('webui.chat.statusThinking', 'Thinking...'));
            }
          }
          return false;
        }

        if (eventType === 'response.completed') {
          finalizeStreamSuccess();
          return true;
        }

        // Fallback: Chat-Completions shape, in case backend later switches.
        const choice = json && json.choices && json.choices[0];
        const delta = choice && choice.delta ? choice.delta : null;
        if (delta) {
          if (typeof delta.reasoning_content === 'string') {
            updateReasoning(assistantEntry, delta.reasoning_content);
            if (hasVisibleReasoning(assistantEntry.reasoningText)) {
              setStatus(text('webui.chat.statusThinking', 'Thinking...'));
            }
          }
          if (delta.content) {
            updateAssistant(assistantEntry, delta.content);
            setStatus(text('webui.chat.statusGenerating', 'Generating...'));
          }
        }
        return false;
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          if (handleStreamChunk(chunk)) return;
        }
      }

      if (buffer.trim() && handleStreamChunk(buffer)) return;

      const finalReasoning = hasVisibleReasoning(assistantEntry.reasoningText) ? assistantEntry.reasoningText : '';
      messages.push({
        role: 'assistant',
        content: assistantEntry.text,
        reasoning_content: finalReasoning,
        createdAt: assistantCreatedAt,
        feedback: '',
        upstream_response_id: assistantEntry.upstreamResponseId || '',
        upstream_conversation_id: assistantEntry.upstreamConversationId || '',
      });
      syncCurrentSession();
      finalizeAssistantEntry(assistantEntry, messages.length - 1);
      setStatus(text('webui.chat.statusDone', 'Completed'));
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setStatus(text('webui.chat.statusStopped', 'Stopped'));
      } else {
        messages.push({
          role: 'error',
          content: `${text('webui.chat.errors.requestFailed', 'Request failed')}: ${error.message || error}`,
          createdAt: Date.now(),
          feedback: '',
        });
        syncCurrentSession();
        renderThread();
        toast(text('webui.chat.errors.requestFailed', 'Request failed'), 'error');
        setStatus(text('webui.chat.statusFailed', 'Failed'));
      }
    } finally {
      abortController = null;
      setSending(false);
      scrollThread();
    }
  }

  function stopMessage() {
    if (abortController) abortController.abort();
  }

  function restoreSessions() {
    const stored = loadStore();
    sessions = stored.sessions.map(normalizeSession);
    currentSessionId = stored.currentSessionId;

    if (!sessions.length) {
      startNewSession();
      return;
    }

    const existing = sessions.find((item) => item.id === currentSessionId) || sessions[0];
    switchSession(existing.id);
  }

  async function boot() {
    await renderWebuiHeader?.();
    await renderSiteFooter?.();
    if (window.I18n?.apply) I18n.apply(document);
    renderSendButton();
    window.I18n?.onReady?.(renderSendButton);
    if (!await ensureAccess()) return;
    loadSidebarState();
    await loadModels();
    restoreChatVoicePreference();
    loadChatVoiceCustomPersonalities();
    renderChatVoicePersonalityOptions();
    restoreChatVoicePersonalityPreference();
    restoreSessions();
    renderVoiceHistory();
    renderChatVoiceUi();
    resizePromptInput();
    promptInput.focus();
  }

  newChatBtn?.addEventListener('click', startNewSession);
  sidebarToggleBtn.addEventListener('click', toggleSidebar);
  continueVoiceBtn?.addEventListener('click', continueVoiceConversation);
  newVoiceSessionBtn?.addEventListener('click', startNewVoiceSession);
  window.addEventListener('storage', (event) => {
    if (event.key === VOICE_HISTORY_KEY || event.key === VOICE_SESSIONS_KEY) renderVoiceHistory();
  });
  sendBtn.addEventListener('click', () => {
    if (sending) {
      stopMessage();
      return;
    }
    if (chatVoiceConnected) {
      void sendChatVoiceText();
      return;
    }
    sendMessage();
  });
  chatVoiceBtn?.addEventListener('click', () => {
    if (chatVoiceConnected) {
      void teardownChatVoiceSession(true);
      return;
    }
    void startChatVoiceSession();
  });
  chatVoiceSelect?.addEventListener('change', () => {
    void restartChatVoiceSessionForVoiceChange();
  });
  chatVoicePersonalitySelect?.addEventListener('change', () => {
    restoreChatVoiceCustomDraft();
    persistChatVoicePersonalityPreference();
    renderChatVoiceInstructionVisibility();
    void restartChatVoiceSessionForVoiceChange();
  });
  chatVoiceInstructionInput?.addEventListener('input', persistChatVoicePersonalityPreference);
  chatVoiceCustomPersonalityNameInput?.addEventListener('input', persistChatVoicePersonalityPreference);
  chatVoiceSaveCustomPersonalityBtn?.addEventListener('click', saveSelectedChatVoiceCustomPersonality);
  chatVoiceDeleteCustomPersonalityBtn?.addEventListener('click', deleteSelectedChatVoiceCustomPersonality);
  window.addEventListener('beforeunload', () => {
    if (chatVoiceRoom) void chatVoiceRoom.disconnect();
  });
  modelSelect.addEventListener('change', syncCurrentSession);
  systemInput?.addEventListener('change', syncCurrentSession);
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    try {
      pendingFiles = await preparePendingFiles(fileInput.files || []);
      renderUploadMeta();
    } catch (error) {
      pendingFiles = [];
      if (fileInput) fileInput.value = '';
      renderUploadMeta();
      toast(error.message || String(error), 'error');
    }
  });
  sessionModalCancel.addEventListener('click', () => closeSessionModal(false));
  sessionModalConfirm.addEventListener('click', () => {
    const result = sessionModalInputWrap.hidden ? true : sessionModalInput.value;
    closeSessionModal(result);
  });
  sessionModal.addEventListener('click', (event) => {
    if (event.target === sessionModal) closeSessionModal(false);
  });
  sessionModalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeSessionModal(sessionModalInput.value);
    }
  });
  promptInput.addEventListener('input', resizePromptInput);
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (chatVoiceConnected) {
        void sendChatVoiceText();
        return;
      }
      sendMessage();
    }
  });

  boot().catch((error) => {
    console.error('webui chat boot failed', error);
    toast(text('webui.chat.errors.initFailed', 'Chat page initialization failed'), 'error');
    setStatus(text('webui.chat.statusInitFailed', 'Initialization failed'));
  });
})();
