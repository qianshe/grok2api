(() => {
  const VOICE_ENDPOINT = '/webui/api/voice/token';
  const VOICE_PREF_KEY = 'grok2api_voice_id';
  const PERSONALITY_PREF_KEY = 'grok2api_voice_personality';
  const CUSTOM_PERSONALITIES_KEY = 'grok2api_voice_custom_personalities';
  const CUSTOM_DRAFT_KEY = 'grok2api_voice_custom_draft';
  const CUSTOM_NEW_VALUE = 'custom_new';
  const CUSTOM_PERSONALITY_PREFIX = 'custom:';
  const voiceSelect = document.getElementById('voiceSelect');
  const personalitySelect = document.getElementById('personalitySelect');
  const speedSelect = document.getElementById('speedSelect');
  const instructionPill = document.getElementById('instructionPill');
  const customPersonalityNameInput = document.getElementById('customPersonalityNameInput');
  const instructionInput = document.getElementById('instructionInput');
  const saveCustomPersonalityBtn = document.getElementById('saveCustomPersonalityBtn');
  const deleteCustomPersonalityBtn = document.getElementById('deleteCustomPersonalityBtn');
  const startVoiceBtn = document.getElementById('startVoiceBtn');
  const muteVoiceBtn = document.getElementById('muteVoiceBtn');
  const newSessionBtn = document.getElementById('newSessionBtn');
  const connectionBadge = document.getElementById('connectionBadge');
  const connectionText = document.getElementById('connectionText');
  const voiceOrb = document.getElementById('voiceOrb');
  const audioRoot = document.getElementById('audioRoot');
  const chatkitThread = document.getElementById('chatkitThread');
  const chatkitComposer = document.getElementById('chatkitComposer');
  const chatkitPromptInput = document.getElementById('chatkitPromptInput');
  const chatkitSendBtn = document.getElementById('chatkitSendBtn');

  let room = null;
  let micEnabled = true;
  let outputMuted = false;
  let orbAudioContext = null;
  const orbInputs = new Map();
  let orbFrame = 0;
  let orbLevel = 0;
  let orbBeat = 0;
  let orbMotionPhase = 0;
  const audioElements = new Set();
  let lastStatusState = '';
  let lastStatusLabel = '';
  let lastStatusDescription = '';
  let chatkitMessageSeq = 0;
  let chatkitSending = false;
  let customPersonalities = [];
  const chatkitMessages = [];
  const realtimeMessageByItemId = new Map();
  let lastRealtimeItemId = null;
  let lastRealtimeResponseAt = 0;
  let voiceReadyResolver = null;
  const VOICE_DEBUG = (() => {
    try { return localStorage.getItem('grok2api_voice_debug') === '1'; } catch { return false; }
  })();
  const controlIcon = {
    start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.25 17 12l-8 4.75V7.25Z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11"/><path d="M15 6.5v11"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h3l4-4v12l-4-4H5z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    unmute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h3l4-4v12l-4-4H5z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>',
    newSession: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  };

  const text = (key, fallback) => {
    if (typeof window.t !== 'function') return fallback;
    const value = t(key);
    return value === key ? fallback : value;
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const roleLabel = (role) => {
    if (role === 'user') return text('webui.chatkit.userLabel', '你');
    if (role === 'assistant') return 'Grok';
    return text('webui.chatkit.systemLabel', '系统');
  };

  const scrollChatkitThread = () => {
    if (!chatkitThread) return;
    chatkitThread.scrollTop = chatkitThread.scrollHeight;
  };

  const renderChatkitMessages = () => {
    if (!chatkitThread) return;
    if (!chatkitMessages.length) {
      chatkitThread.innerHTML = `<div class="webui-chatkit-empty">${escapeHtml(text('webui.chatkit.emptyThread', '文本消息和语音转录会显示在这里。'))}</div>`;
      return;
    }

    chatkitThread.innerHTML = chatkitMessages.map((message) => {
      const role = message.role === 'user' || message.role === 'assistant' ? message.role : 'system';
      const partial = message.partial ? `<span class="webui-chatkit-partial">${escapeHtml(text('webui.chatkit.partial', '转录中'))}</span>` : '';
      return `
        <article class="webui-chatkit-message webui-chatkit-message-${role}">
          <div class="webui-chatkit-message-meta">
            <span>${escapeHtml(roleLabel(role))}</span>${partial}
          </div>
          <div class="webui-chatkit-message-body">${escapeHtml(message.text).replace(/\n/g, '<br>')}</div>
        </article>`;
    }).join('');
    scrollChatkitThread();
  };

  const upsertChatkitMessage = (role, content, options = {}) => {
    const normalizedText = String(content || '').trim();
    if (!normalizedText && !options.partial) return null;

    const id = options.id || `chatkit-${++chatkitMessageSeq}`;
    let message = chatkitMessages.find((item) => item.id === id);
    if (!message) {
      message = {
        id,
        role: role || 'system',
        text: normalizedText,
        partial: Boolean(options.partial),
        timestamp: options.timestamp || Date.now(),
      };
      chatkitMessages.push(message);
    } else {
      message.role = role || message.role;
      message.text = normalizedText || message.text;
      message.partial = Boolean(options.partial);
      message.timestamp = options.timestamp || message.timestamp;
    }
    renderChatkitMessages();
    return message;
  };

  const appendChatkitMessage = (role, content, options = {}) => upsertChatkitMessage(
    role,
    content,
    { ...options, id: options.id || `chatkit-${++chatkitMessageSeq}` },
  );

  const setChatkitSending = (sending) => {
    chatkitSending = Boolean(sending);
    if (chatkitSendBtn) chatkitSendBtn.disabled = chatkitSending;
    if (chatkitPromptInput) chatkitPromptInput.disabled = chatkitSending;
  };

  const resizeChatkitInput = () => {
    if (!chatkitPromptInput) return;
    chatkitPromptInput.style.height = 'auto';
    chatkitPromptInput.style.height = `${Math.min(132, chatkitPromptInput.scrollHeight)}px`;
  };

  const safeUrlHost = (value) => {
    try {
      return new URL(String(value || '')).host || '-';
    } catch {
      return '-';
    }
  };

  const voiceDiagnostic = (message, details = {}) => {
    if (!VOICE_DEBUG) return;
    const suffix = Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ');
    const textValue = suffix ? `${message} (${suffix})` : message;
    appendChatkitMessage('system', textValue);
    console.debug('[grok2api voice]', textValue);
  };

  const voiceErrorDiagnostic = (message, details = {}) => {
    const suffix = Object.entries(details)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ');
    const textValue = suffix ? `${message} (${suffix})` : message;
    console.error('[grok2api voice]', textValue);
    if (VOICE_DEBUG) appendChatkitMessage('system', textValue);
  };

  const safeErrorDetails = (error) => {
    if (!error) return {};
    return {
      name: error.name || error.constructor?.name || '',
      message: error.message || String(error),
      code: error.code || '',
      reason: error.reason || '',
      state: room?.state || '',
      signalState: room?.engine?.client?.signalState || room?.engine?.signalState || '',
      pcState: room?.engine?.pcManager?.currentState || room?.engine?.pcManager?.pc?.connectionState || '',
      iceState: room?.engine?.pcManager?.pc?.iceConnectionState || '',
      publisherState: room?.engine?.pcManager?.publisher?.getConnectionState?.() || '',
      subscriberState: room?.engine?.pcManager?.subscriber?.getConnectionState?.() || '',
      requiredTransports: Array.isArray(room?.engine?.pcManager?.requiredTransports)
        ? room.engine.pcManager.requiredTransports.length
        : '',
      participants: room?.remoteParticipants?.size ?? '',
      roomSid: typeof room?.getSid === 'function' ? '' : '',
      cause: error.cause?.message || error.cause || '',
    };
  };

  const voiceEventDiagnostic = (eventName, details = {}) => {
    voiceDiagnostic(`LiveKit event: ${eventName}`, details);
  };

  const livekitJoinSummary = (currentRoom) => {
    const join = currentRoom?.engine?.latestJoinResponse || {};
    const roomInfo = join.room || {};
    return {
      roomName: roomInfo.name || currentRoom?.name || '',
      roomSid: roomInfo.sid || '',
      otherParticipants: Array.isArray(join.otherParticipants) ? join.otherParticipants.length : '',
      iceServers: Array.isArray(join.iceServers) ? join.iceServers.length : '',
      iceUrls: Array.isArray(join.iceServers)
        ? join.iceServers
          .flatMap((server) => Array.isArray(server.urls) ? server.urls : [server.urls])
          .filter(Boolean)
          .map((url) => String(url).replace(/([?&]credential=)[^&]+/g, '$1***'))
          .join(',')
        : '',
      forceRelay: join.clientConfiguration?.forceRelay ?? '',
      serverVersion: join.serverInfo?.version || '',
    };
  };

  const normalizeComparableText = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s。．.！？!?，,、~～]+/g, '');

  const findDuplicateMessage = (role, textValue) => {
    const comparable = normalizeComparableText(textValue);
    if (!comparable) return null;
    return chatkitMessages.find((message) => (
      message.role === role
      && normalizeComparableText(message.text) === comparable
    )) || null;
  };

  const extractTextFromValue = (value) => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    for (const key of ['text', 'transcript', 'message', 'content', 'delta']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key];
    }
    if (Array.isArray(value.content)) {
      return value.content.map(extractTextFromValue).filter(Boolean).join(' ');
    }
    if (Array.isArray(value.segments)) {
      return value.segments.map(extractTextFromValue).filter(Boolean).join(' ');
    }
    if (Array.isArray(value.items)) {
      return value.items.map(extractTextFromValue).filter(Boolean).join(' ');
    }
    return '';
  };

  const normalizeTranscriptRole = (payload, participant) => {
    const rawRole = String(payload?.role || payload?.sender || payload?.speaker || '').toLowerCase();
    if (rawRole.includes('assistant') || rawRole.includes('agent') || rawRole.includes('grok')) return 'assistant';
    if (rawRole.includes('user') || rawRole.includes('human')) return 'user';
    if (participant?.isLocal) return 'user';
    return 'assistant';
  };

  const isPartialTranscript = (payload) => {
    if (!payload || typeof payload !== 'object') return false;
    if (typeof payload.final === 'boolean') return !payload.final;
    if (typeof payload.isFinal === 'boolean') return !payload.isFinal;
    if (typeof payload.partial === 'boolean') return payload.partial;
    return false;
  };

  const handleTranscriptPayload = (payload, participant, fallbackIdPrefix = 'transcript') => {
    const items = Array.isArray(payload) ? payload : [payload];
    items.forEach((item, index) => {
      const content = extractTextFromValue(item);
      if (!content.trim()) return;
      const role = normalizeTranscriptRole(item, participant);
      const upstreamId = item && typeof item === 'object'
        ? (item.id || item.segmentId || item.transcriptionId || item.messageId || '')
        : '';
      const id = `${fallbackIdPrefix}:${participant?.identity || role}:${upstreamId || index}`;
      upsertChatkitMessage(role, content, {
        id,
        partial: isPartialTranscript(item),
        timestamp: Date.now(),
      });
    });
  };

  const decodeDataPayload = (payload) => {
    try {
      if (payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
        const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
        return new TextDecoder('utf-8').decode(bytes);
      }
      return String(payload || '');
    } catch {
      return '';
    }
  };

  const parseDataPayload = (payload) => {
    const raw = decodeDataPayload(payload).trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  };

  const realtimeTextFromContent = (content) => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(extractTextFromValue).filter(Boolean).join(' ').trim();
  };

  const updateRealtimeMessage = (role, itemId, content, partial = false) => {
    const textValue = String(content || '').trim();
    if (!textValue && !partial) return;
    const mappedId = itemId ? realtimeMessageByItemId.get(itemId) : '';
    const duplicate = textValue && !partial ? findDuplicateMessage(role, textValue) : null;
    const id = mappedId || duplicate?.id || (itemId ? `realtime:${itemId}` : `realtime:${role}:${++chatkitMessageSeq}`);
    realtimeMessageByItemId.set(itemId || id, id);
    upsertChatkitMessage(role, textValue || '…', { id, partial, timestamp: Date.now() });
  };

  const appendRealtimeDelta = (itemId, delta) => {
    const textValue = String(delta || '');
    if (!textValue) return;
    const id = realtimeMessageByItemId.get(itemId) || `realtime:${itemId || ++chatkitMessageSeq}`;
    const existing = chatkitMessages.find((message) => message.id === id);
    const nextText = `${existing?.text || ''}${textValue}`;
    realtimeMessageByItemId.set(itemId || id, id);
    upsertChatkitMessage('assistant', nextText, { id, partial: true, timestamp: Date.now() });
  };

  const finalizeRealtimeMessage = (itemId) => {
    const id = realtimeMessageByItemId.get(itemId);
    if (!id) return;
    const existing = chatkitMessages.find((message) => message.id === id);
    if (existing) upsertChatkitMessage(existing.role, existing.text, { id, partial: false, timestamp: Date.now() });
  };

  const handleRealtimeServerEvent = (event) => {
    if (!event || typeof event !== 'object') return false;
    const type = String(event.type || '');
    if (
      !type
      || type === 'ping'
      || type === 'rate_limits.updated'
      || type === 'input_audio_buffer.speech_started'
      || type === 'input_audio_buffer.speech_stopped'
      || type === 'input_audio_buffer.committed'
    ) return true;

    if (type.startsWith('response.')) lastRealtimeResponseAt = Date.now();
    if (event.previous_item_id) lastRealtimeItemId = event.previous_item_id;

    if (type === 'conversation.created') {
      if (voiceReadyResolver) {
        voiceReadyResolver();
        voiceReadyResolver = null;
      }
      return true;
    }

    if (type === 'session.updated') return true;

    if (type === 'conversation.item.created' && event.item) {
      const item = event.item;
      if (item.id) lastRealtimeItemId = item.id;
      const content = realtimeTextFromContent(item.content);
      if (content) updateRealtimeMessage(item.role === 'user' ? 'user' : 'assistant', item.id, content, item.status === 'in_progress');
      return true;
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      updateRealtimeMessage('user', event.item_id || event.event_id, event.transcript || '', false);
      return true;
    }

    if (type === 'response.audio_transcript.delta' || type === 'response.output_text.delta' || type === 'response.text.delta') {
      appendRealtimeDelta(event.item_id, event.delta || '');
      return true;
    }

    if (type === 'response.audio_transcript.done' || type === 'response.output_text.done' || type === 'response.text.done') {
      const doneText = event.transcript || event.text || '';
      if (doneText) updateRealtimeMessage('assistant', event.item_id, doneText, false);
      else finalizeRealtimeMessage(event.item_id);
      return true;
    }

    if (type === 'response.audio.done' || type === 'response.output_item.done' || type === 'response.done') {
      finalizeRealtimeMessage(event.item_id);
      return true;
    }

    if (type === 'response.human_assist_turn.commit') {
      const turn = event.human_assist_turn_response || {};
      const userText = extractTextFromValue(turn.user);
      const assistantText = extractTextFromValue(turn.assistant);
      if (userText) updateRealtimeMessage('user', `${turn.id || event.event_id}:user`, userText, false);
      if (assistantText) updateRealtimeMessage('assistant', `${turn.id || event.event_id}:assistant`, assistantText, false);
      return true;
    }

    return true;
  };

  const handleDataPayload = (payload, participant, topic) => {
    const parsed = parseDataPayload(payload);
    if (!parsed) return;

    const topicName = String(topic || '');
    const events = Array.isArray(parsed) ? parsed : [parsed];
    if (topicName === 'realtime_server_events') {
      events.forEach(handleRealtimeServerEvent);
      return;
    }

    events.forEach((item, index) => {
      const eventType = item && typeof item === 'object' ? String(item.type || '') : '';
      if (eventType === 'ping') return;
      if (eventType.startsWith('response.') || eventType.startsWith('conversation.') || eventType.startsWith('input_audio_buffer.')) {
        handleRealtimeServerEvent(item);
        return;
      }
      const content = extractTextFromValue(item);
      if (!content.trim()) return;
      const role = normalizeTranscriptRole(item, participant);
      const idPart = item && typeof item === 'object'
        ? (item.id || item.messageId || item.segmentId || '')
        : '';
      upsertChatkitMessage(role, content, {
        id: `data:${topicName || 'default'}:${participant?.identity || role}:${idPart || index}`,
        partial: isPartialTranscript(item),
        timestamp: Date.now(),
      });
    });
  };

  const setOrbLevel = (level) => {
    orbLevel = Math.max(0, Math.min(1, level || 0));
    if (!voiceOrb) return;
    voiceOrb.style.setProperty('--chatkit-level', orbLevel.toFixed(3));
    voiceOrb.classList.toggle('is-speaking', voiceOrb.classList.contains('is-live') && orbLevel > 0.045);
  };

  const setOrbBeat = (value) => {
    orbBeat = Math.max(0, Math.min(1, value || 0));
    if (!voiceOrb) return;
    voiceOrb.style.setProperty('--chatkit-beat', orbBeat.toFixed(3));
  };

  const setOrbMotion = (level) => {
    if (!voiceOrb) return;
    const intensity = Math.max(0, Math.min(1, level || 0));
    const activeIntensity = intensity > 0.03 ? Math.max(intensity, 0.18) : 0;
    const distance = activeIntensity * 11;
    orbMotionPhase += 0.14 + activeIntensity * 0.18;
    const drift = (speed, amplitude, offset = 0) => Math.sin(orbMotionPhase * speed + offset) * amplitude * distance;

    voiceOrb.style.setProperty('--chatkit-drift-a-x', `${drift(0.92, 0.95, 0.2).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-a-y', `${drift(1.08, 0.9, 1.1).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-b-x', `${drift(1.16, 0.82, 2.4).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-b-y', `${drift(0.98, 0.76, 0.7).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-c-x', `${drift(1.04, 1.02, 3.1).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-c-y', `${drift(1.22, 0.84, 1.8).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-d-x', `${drift(0.88, 0.78, 4.2).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-d-y', `${drift(1.14, 0.74, 2.7).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-e-x', `${drift(1.28, 0.62, 5.1).toFixed(2)}px`);
    voiceOrb.style.setProperty('--chatkit-drift-e-y', `${drift(0.94, 0.58, 3.5).toFixed(2)}px`);
  };

  const disconnectOrbInput = (entry) => {
    if (!entry) return;
    if (entry.source) {
      try {
        entry.source.disconnect();
      } catch {}
    }
  };

  const ensureOrbAudioContext = async () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!orbAudioContext) orbAudioContext = new AudioContextCtor();
    if (orbAudioContext.state === 'suspended') {
      try {
        await orbAudioContext.resume();
      } catch {}
    }
    return orbAudioContext;
  };

  const measureOrbInput = (analyser, data) => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const normalized = (data[index] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.max(0, Math.min(1, (rms - 0.01) * 14));
  };

  const stopOrbLoop = () => {
    if (!orbFrame) return;
    cancelAnimationFrame(orbFrame);
    orbFrame = 0;
  };

  const stopOrbAnalysis = () => {
    stopOrbLoop();
    orbInputs.forEach(disconnectOrbInput);
    orbInputs.clear();
    setOrbLevel(0);
    setOrbBeat(0);
  };

  const startOrbLoop = () => {
    if (orbFrame) return;
    const render = () => {
      let strongest = 0;
      let total = 0;
      orbInputs.forEach((entry) => {
        const level = measureOrbInput(entry.analyser, entry.data);
        strongest = Math.max(strongest, level);
        total += level;
      });

      const targetLevel = orbInputs.size
        ? Math.max(strongest, Math.min(1, strongest * 0.86 + total * 0.12))
        : 0;
      const smoothing = targetLevel > orbLevel ? 0.38 : 0.18;
      const nextLevel = orbLevel + (targetLevel - orbLevel) * smoothing;
      const normalizedLevel = nextLevel < 0.006 ? 0 : nextLevel;
      const beatTarget = orbInputs.size ? Math.min(1, strongest * 1.35) : 0;
      const beatSmoothing = beatTarget > orbBeat ? 0.58 : 0.14;
      const nextBeat = orbBeat + (beatTarget - orbBeat) * beatSmoothing;
      setOrbLevel(normalizedLevel);
      setOrbBeat(nextBeat < 0.01 ? 0 : nextBeat);
      setOrbMotion(normalizedLevel);

      if (!orbInputs.size && normalizedLevel < 0.006) {
        orbFrame = 0;
        return;
      }
      orbFrame = requestAnimationFrame(render);
    };
    orbFrame = requestAnimationFrame(render);
  };

  const removeOrbInput = (key) => {
    const entry = orbInputs.get(key);
    if (!entry) return;
    disconnectOrbInput(entry);
    orbInputs.delete(key);
    if (!orbInputs.size) stopOrbLoop();
  };

  const removeOrbInputsByPrefix = (prefix) => {
    Array.from(orbInputs.keys()).forEach((key) => {
      if (key.startsWith(prefix)) removeOrbInput(key);
    });
  };

  const attachOrbStream = async (stream, key) => {
    if (!(stream instanceof MediaStream) || !key || orbInputs.has(key)) return;

    const context = await ensureOrbAudioContext();
    if (!context) return;

    try {
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const data = new Uint8Array(analyser.fftSize);
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      orbInputs.set(key, { analyser, data, source });
      startOrbLoop();
    } catch {}
  };

  const getMediaStreamTrack = (trackOrPublication) => {
    const candidate = trackOrPublication?.track || trackOrPublication;
    const mediaTrack = candidate?.mediaStreamTrack
      || candidate?.track?.mediaStreamTrack
      || candidate?._mediaStreamTrack
      || null;
    if (!mediaTrack || mediaTrack.kind !== 'audio' || mediaTrack.readyState !== 'live') return null;
    return mediaTrack;
  };

  const syncLocalMicAnalysis = async (currentRoom) => {
    removeOrbInputsByPrefix('local:');
    if (!currentRoom || !micEnabled) return;

    const publications = currentRoom.localParticipant?.trackPublications;
    if (!publications || typeof publications.values !== 'function') return;

    for (const publication of publications.values()) {
      const mediaTrack = getMediaStreamTrack(publication);
      if (!mediaTrack || mediaTrack.enabled === false) continue;
      const stream = new MediaStream([mediaTrack]);
      await attachOrbStream(stream, `local:${mediaTrack.id || 'mic'}`);
      break;
    }
  };

  const setStatus = (state, label, description) => {
    if (connectionBadge && lastStatusLabel !== label) connectionBadge.textContent = label;
    if (connectionBadge && lastStatusState !== state) connectionBadge.dataset.state = state;
    if (connectionText && lastStatusDescription !== description) connectionText.textContent = description;
    lastStatusState = state;
    lastStatusLabel = label;
    lastStatusDescription = description;
    if (voiceOrb) {
      if (!voiceOrb.classList.contains(state)) {
        voiceOrb.classList.remove('is-idle', 'is-connecting', 'is-live', 'is-paused', 'is-output-muted', 'is-error');
        voiceOrb.classList.add(state);
      }
      if (state !== 'is-live') {
        voiceOrb.classList.remove('is-speaking');
        setOrbLevel(0);
        setOrbBeat(0);
      }
    }
  };

  const selectedVoiceId = () => String(voiceSelect?.value || 'ara').trim() || 'ara';

  const normalizeCustomPersonality = (entry) => {
    const id = String(entry?.id || '').trim();
    const name = String(entry?.name || '').trim();
    const instruction = String(entry?.instruction || '').trim();
    if (!id || !name || !instruction) return null;
    return { id, name, instruction };
  };

  const customPersonalityValue = (id) => `${CUSTOM_PERSONALITY_PREFIX}${id}`;
  const isCustomPersonalityValue = (value) => String(value || '').startsWith(CUSTOM_PERSONALITY_PREFIX);
  const selectedPersonalityValue = () => String(personalitySelect?.value || 'assistant').trim() || 'assistant';
  const selectedCustomPersonalityId = () => (
    isCustomPersonalityValue(selectedPersonalityValue())
      ? selectedPersonalityValue().slice(CUSTOM_PERSONALITY_PREFIX.length)
      : ''
  );
  const selectedCustomPersonality = () => {
    const id = selectedCustomPersonalityId();
    return customPersonalities.find((item) => item.id === id) || null;
  };
  const isCustomPersonality = () => selectedPersonalityValue() === CUSTOM_NEW_VALUE || Boolean(selectedCustomPersonality());

  const selectedPersonality = () => {
    const value = selectedPersonalityValue();
    return value === CUSTOM_NEW_VALUE || isCustomPersonalityValue(value) ? 'assistant' : value;
  };

  const selectedCustomInstruction = () => {
    const saved = selectedCustomPersonality();
    if (saved) return saved.instruction;
    return isCustomPersonality() ? String(instructionInput?.value || '').trim() : '';
  };

  const selectedCustomPersonalityName = () => {
    const saved = selectedCustomPersonality();
    if (saved) return saved.name;
    return String(customPersonalityNameInput?.value || '').trim();
  };

  const loadCustomPersonalities = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_PERSONALITIES_KEY) || '[]');
      customPersonalities = Array.isArray(parsed)
        ? parsed.map(normalizeCustomPersonality).filter(Boolean)
        : [];
    } catch {
      customPersonalities = [];
    }
  };

  const saveCustomPersonalities = () => {
    try { localStorage.setItem(CUSTOM_PERSONALITIES_KEY, JSON.stringify(customPersonalities)); } catch {}
  };

  const appendCustomPersonalityOptions = () => {
    if (!personalitySelect) return;
    const anchor = personalitySelect.querySelector(`option[value="${CUSTOM_NEW_VALUE}"]`);
    customPersonalities.forEach((item) => {
      const option = document.createElement('option');
      option.value = customPersonalityValue(item.id);
      option.textContent = item.name;
      if (anchor) personalitySelect.insertBefore(option, anchor); else personalitySelect.appendChild(option);
    });
  };

  const renderPersonalityOptions = () => {
    if (!personalitySelect) return;
    personalitySelect.querySelectorAll(`option[value^="${CUSTOM_PERSONALITY_PREFIX}"]`).forEach((option) => option.remove());
    appendCustomPersonalityOptions();
  };

  const persistCustomInstructionPreference = () => {
    try {
      localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({
        name: String(customPersonalityNameInput?.value || ''),
        instruction: String(instructionInput?.value || ''),
      }));
    } catch {}
  };

  const restoreCustomInstructionPreference = () => {
    const saved = selectedCustomPersonality();
    if (saved) {
      if (customPersonalityNameInput) customPersonalityNameInput.value = saved.name;
      if (instructionInput) instructionInput.value = saved.instruction;
      return;
    }
    try {
      const draft = JSON.parse(localStorage.getItem(CUSTOM_DRAFT_KEY) || '{}');
      if (customPersonalityNameInput) customPersonalityNameInput.value = String(draft?.name || '');
      if (instructionInput) instructionInput.value = String(draft?.instruction || '');
    } catch {
      if (customPersonalityNameInput) customPersonalityNameInput.value = '';
      if (instructionInput) instructionInput.value = '';
    }
  };

  const renderInstructionVisibility = () => {
    const enabled = isCustomPersonality();
    if (instructionPill) instructionPill.hidden = !enabled;
    if (instructionInput) instructionInput.disabled = !enabled;
    if (customPersonalityNameInput) customPersonalityNameInput.disabled = !enabled;
    if (saveCustomPersonalityBtn) saveCustomPersonalityBtn.disabled = !enabled;
    if (deleteCustomPersonalityBtn) deleteCustomPersonalityBtn.disabled = !selectedCustomPersonality();
    restoreCustomInstructionPreference();
  };

  const persistVoicePreference = () => {
    try { localStorage.setItem(VOICE_PREF_KEY, selectedVoiceId()); } catch {}
  };

  const restoreVoicePreference = () => {
    if (!voiceSelect) return;
    try {
      const stored = String(localStorage.getItem(VOICE_PREF_KEY) || '').trim();
      if (stored && Array.from(voiceSelect.options).some((option) => option.value === stored)) {
        voiceSelect.value = stored;
      }
    } catch {}
  };

  const persistPersonalityPreference = () => {
    try { localStorage.setItem(PERSONALITY_PREF_KEY, String(personalitySelect?.value || 'assistant')); } catch {}
  };

  const restorePersonalityPreference = () => {
    if (!personalitySelect) return;
    try {
      const stored = String(localStorage.getItem(PERSONALITY_PREF_KEY) || '').trim();
      if (stored && Array.from(personalitySelect.options).some((option) => option.value === stored)) {
        personalitySelect.value = stored;
      }
    } catch {}
  };

  const createCustomPersonalityId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const saveSelectedCustomPersonality = () => {
    const name = selectedCustomPersonalityName();
    const instruction = String(instructionInput?.value || '').trim();
    if (!name || !instruction) {
      showToast?.('请先填写个性名称和 Instruction', 'error');
      return;
    }

    const currentId = selectedCustomPersonalityId();
    const id = currentId || createCustomPersonalityId();
    const next = { id, name, instruction };
    const index = customPersonalities.findIndex((item) => item.id === id);
    if (index >= 0) customPersonalities[index] = next;
    else customPersonalities.push(next);
    saveCustomPersonalities();
    renderPersonalityOptions();
    if (personalitySelect) personalitySelect.value = customPersonalityValue(id);
    persistPersonalityPreference();
    renderInstructionVisibility();
    showToast?.('自定义个性已保存', 'success');
  };

  const deleteSelectedCustomPersonality = () => {
    const currentId = selectedCustomPersonalityId();
    if (!currentId) return;
    customPersonalities = customPersonalities.filter((item) => item.id !== currentId);
    saveCustomPersonalities();
    renderPersonalityOptions();
    if (personalitySelect) personalitySelect.value = CUSTOM_NEW_VALUE;
    persistPersonalityPreference();
    if (customPersonalityNameInput) customPersonalityNameInput.value = '';
    if (instructionInput) instructionInput.value = '';
    persistCustomInstructionPreference();
    renderInstructionVisibility();
    showToast?.('自定义个性已删除', 'success');
  };

  const renderConnectedStatus = () => {
    if (!room) {
      setStatus(
        'is-idle',
        text('webui.chatkit.statusIdle', '未连接'),
        text('webui.chatkit.idleText', '点击并授权，通过 ChatKit 语音会话连接 Grok Voice。'),
      );
      return;
    }

    if (!micEnabled) {
      setStatus(
        'is-paused',
        text('webui.chatkit.statusPaused', '已暂停'),
        text('webui.chatkit.pausedText', '会话已暂停，点击开始即可继续当前语音会话。'),
      );
      return;
    }

    if (outputMuted) {
      setStatus(
        'is-output-muted',
        text('webui.chatkit.statusMuted', '已静音'),
        text('webui.chatkit.outputMutedText', '扬声器已静音，你仍然可以继续说话。'),
      );
      return;
    }

    setStatus(
      'is-live',
      text('webui.chatkit.statusLive', '语音中'),
      text('webui.chatkit.liveText', '连接已建立，现在可以直接开口和 Grok 对话。'),
    );
  };

  const setButtons = (connected) => {
    if (startVoiceBtn) {
      startVoiceBtn.disabled = false;
      const label = connected && micEnabled
        ? text('webui.chatkit.pause', '暂停')
        : text('webui.chatkit.start', '开始');
      startVoiceBtn.innerHTML = connected && micEnabled ? controlIcon.pause : controlIcon.start;
      startVoiceBtn.setAttribute('aria-label', label);
      startVoiceBtn.setAttribute('title', label);
    }
    if (muteVoiceBtn) {
      muteVoiceBtn.disabled = !connected;
      const label = outputMuted
        ? text('webui.chatkit.unmute', '取消静音')
        : text('webui.chatkit.mute', '静音');
      muteVoiceBtn.innerHTML = outputMuted ? controlIcon.unmute : controlIcon.mute;
      muteVoiceBtn.setAttribute('aria-label', label);
      muteVoiceBtn.setAttribute('title', label);
    }
    if (newSessionBtn) {
      newSessionBtn.disabled = !connected;
      const label = text('webui.chatkit.newSession', '新会话');
      newSessionBtn.innerHTML = controlIcon.newSession;
      newSessionBtn.setAttribute('aria-label', label);
      newSessionBtn.setAttribute('title', label);
    }
  };

  const detachAudio = () => {
    stopOrbAnalysis();
    audioElements.forEach((node) => {
      try {
        node.pause();
        node.srcObject = null;
      } catch {}
      node.remove();
    });
    audioElements.clear();
  };

  const getLiveKit = () => window.LiveKitClient || window.LivekitClient || null;

  const getAuthHeaders = async () => {
    const key = await webuiKey.get();
    return key ? { Authorization: `Bearer ${key}` } : {};
  };

  const addRemoteAudioTrack = (track) => {
    if (!audioRoot || !track || track.kind !== 'audio') return;
    const element = track.attach();
    element.autoplay = true;
    element.playsInline = true;
    element.muted = outputMuted;
    audioRoot.appendChild(element);
    audioElements.add(element);
    const stream = element.srcObject instanceof MediaStream ? element.srcObject : null;
    const streamId = stream?.id || stream?.getAudioTracks?.()[0]?.id || '';
    if (stream && streamId) {
      void attachOrbStream(stream, `remote:${streamId}`);
    }
  };

  const bindParticipantTranscriptEvents = (lk, participant) => {
    if (!participant || !lk.ParticipantEvent?.TranscriptionReceived || participant.__grok2apiTranscriptBound) return;
    participant.__grok2apiTranscriptBound = true;
    participant.on(lk.ParticipantEvent.TranscriptionReceived, (segments, publication) => {
      handleTranscriptPayload(segments, participant, `participant:${publication?.trackSid || participant.identity || 'unknown'}`);
    });
  };

  const bindRoomEvents = (lk, currentRoom) => {
    currentRoom.remoteParticipants?.forEach?.((participant) => bindParticipantTranscriptEvents(lk, participant));

    const bindEvent = (eventName, handler) => {
      const eventValue = lk.RoomEvent?.[eventName];
      if (!eventValue || typeof currentRoom.on !== 'function') return;
      currentRoom.on(eventValue, handler);
    };

    bindEvent('ConnectionStateChanged', (state) => {
      voiceEventDiagnostic('ConnectionStateChanged', { state });
    });
    bindEvent('SignalConnected', () => {
      voiceEventDiagnostic('SignalConnected', {
        state: currentRoom.state || '',
        ...livekitJoinSummary(currentRoom),
      });
    });
    bindEvent('Reconnecting', () => {
      voiceEventDiagnostic('Reconnecting', { state: currentRoom.state || '' });
    });
    bindEvent('Reconnected', () => {
      voiceEventDiagnostic('Reconnected', { state: currentRoom.state || '' });
    });
    bindEvent('MediaDevicesError', (error) => {
      voiceEventDiagnostic('MediaDevicesError', safeErrorDetails(error));
      console.error('[grok2api voice] media devices error', error);
    });
    bindEvent('ConnectionQualityChanged', (quality, participant) => {
      voiceEventDiagnostic('ConnectionQualityChanged', {
        quality,
        participant: participant?.identity || '',
      });
    });

    currentRoom.on(lk.RoomEvent.TrackSubscribed, (track) => {
      addRemoteAudioTrack(track);
    });

    currentRoom.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      try {
        const elements = track.detach();
        elements.forEach((el) => {
          let streamId = '';
          if (el instanceof HTMLMediaElement && el.srcObject instanceof MediaStream) {
            streamId = el.srcObject.id || el.srcObject.getAudioTracks?.()[0]?.id || '';
          }
          if (streamId) removeOrbInput(`remote:${streamId}`);
          if (el instanceof HTMLAudioElement) audioElements.delete(el);
          el.remove();
        });
      } catch {}
    });

    if (lk.RoomEvent.ParticipantConnected) {
      currentRoom.on(lk.RoomEvent.ParticipantConnected, (participant) => {
        bindParticipantTranscriptEvents(lk, participant);
      });
    }

    if (lk.RoomEvent.TranscriptionReceived) {
      currentRoom.on(lk.RoomEvent.TranscriptionReceived, (segments, participant) => {
        handleTranscriptPayload(segments, participant, 'transcript');
      });
    }

    if (lk.RoomEvent.DataReceived) {
      currentRoom.on(lk.RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        handleDataPayload(payload, participant, topic || 'livekit');
      });
    }

    currentRoom.on(lk.RoomEvent.Disconnected, () => {
      voiceEventDiagnostic('Disconnected', safeErrorDetails(null));
      if (lastStatusState === 'is-live') {
        teardownSession(false);
      }
    });
  };

  const remoteParticipantIdentities = () => {
    if (!room?.remoteParticipants || typeof room.remoteParticipants.values !== 'function') return [];
    return Array.from(room.remoteParticipants.values())
      .map((participant) => participant.identity)
      .filter(Boolean);
  };

  const waitForRemoteParticipant = async (timeoutMs = 5000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (remoteParticipantIdentities().length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return remoteParticipantIdentities().length > 0;
  };

  const waitForVoiceReady = async (timeoutMs = 30000) => {
    if (lastRealtimeResponseAt > 0) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (voiceReadyResolver) voiceReadyResolver = null;
        resolve(false);
      }, timeoutMs);
      voiceReadyResolver = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
  };

  const sendLiveKitText = async (content) => {
    if (!room || !room.localParticipant) throw new Error(text('webui.chatkit.notConnected', '请先连接 Grok Voice'));
    const agentReady = await waitForRemoteParticipant();
    if (!agentReady) {
      throw new Error(text('webui.chatkit.agentNotReady', 'Grok Voice Agent 尚未就绪，请稍后再发送'));
    }
    const participant = room.localParticipant;
    if (typeof participant.publishData === 'function') {
      const payload = new TextEncoder().encode(content);
      const options = {
        reliable: true,
        topic: 'grok.chat',
      };
      try {
        await participant.publishData(payload, options);
      } catch (error) {
        console.debug('Grok Voice text publish retry', error);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await participant.publishData(payload, options);
      }
      return true;
    }
    if (typeof participant.sendText === 'function') {
      await participant.sendText(content, {
        topic: 'lk.chat',
        destinationIdentities: remoteParticipantIdentities(),
      });
      return true;
    }
    if (typeof participant.sendChatMessage === 'function') {
      await participant.sendChatMessage(content, {
        destinationIdentities: remoteParticipantIdentities(),
      });
      return true;
    }
    return false;
  };

  const stopVoicePing = () => {
  };

  const startVoicePing = () => {
  };

  const sendVoiceTextMessage = async (content) => {
    const trimmed = String(content || '').trim();
    if (!trimmed) return;

    const baseline = lastRealtimeResponseAt;
    const sentViaSdkText = await sendLiveKitText(trimmed).catch((error) => {
      console.debug('LiveKit text stream failed', error);
      return false;
    });
    if (!sentViaSdkText) {
      throw new Error(text('webui.chatkit.dataUnavailable', '当前 Voice 会话不支持文本事件发送'));
    }
    await new Promise((resolve) => setTimeout(resolve, 7000));
    if (lastRealtimeResponseAt <= baseline) {
      appendChatkitMessage('system', text(
        'webui.chatkit.noTextResponse',
        '文本已通过 Grok Voice 官方 grok.chat 通道发送，但暂未收到响应。',
      ));
    }
  };

  const submitChatkitText = async () => {
    if (chatkitSending) return;
    const content = String(chatkitPromptInput?.value || '').trim();
    if (!content) return;

    appendChatkitMessage('user', content);
    if (chatkitPromptInput) {
      chatkitPromptInput.value = '';
      resizeChatkitInput();
    }

    setChatkitSending(true);
    try {
      await sendVoiceTextMessage(content);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      appendChatkitMessage('system', `${text('webui.chat.errors.requestFailed', 'Request failed')}: ${message}`);
      showToast?.(message, 'error');
    } finally {
      setChatkitSending(false);
    }
  };

  const teardownSession = async (manual) => {
    const currentRoom = room;
    if (voiceReadyResolver) {
      voiceReadyResolver = null;
    }
    stopVoicePing();
    room = null;
    try {
      if (currentRoom) await currentRoom.disconnect();
    } catch {}
    detachAudio();
    micEnabled = true;
    outputMuted = false;
    setButtons(false);
    renderConnectedStatus();
    if (manual && connectionText) {
      connectionText.textContent = text('webui.chatkit.endedText', '语音会话已结束，可以重新开始。');
    }
  };

  const startSession = async () => {
    const lk = getLiveKit();
    if (!lk || !lk.Room) {
      showToast?.(text('webui.chatkit.livekitLoadFailed', 'LiveKit SDK 加载失败'), 'error');
      return;
    }

    if (startVoiceBtn) startVoiceBtn.disabled = true;
    try {
      if (lk.setLogLevel && lk.LogLevel) lk.setLogLevel(lk.LogLevel.error);
    } catch {}
    void ensureOrbAudioContext();
    setStatus(
      'is-connecting',
      text('webui.chatkit.statusConnecting', '正在连接'),
      text('webui.chatkit.connectingText', '正在向 Grok Voice 申请会话并连接 LiveKit…'),
    );

    try {
      const headers = await getAuthHeaders();
      headers['Content-Type'] = 'application/json';
      const params = new URLSearchParams({
        voice: selectedVoiceId(),
        personality: selectedPersonality(),
        speed: speedSelect?.value || '1',
        instruction: selectedCustomInstruction(),
      });
      const res = await fetch(`${VOICE_ENDPOINT}?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const payload = await res.json();
      if (!payload || !payload.token || !payload.url) {
        throw new Error(text('webui.chatkit.invalidToken', 'Voice token response invalid'));
      }
      const livekitHost = safeUrlHost(payload.url);
      voiceDiagnostic('Voice token OK', {
        urlHost: livekitHost,
        tokenLen: String(payload.token || '').length,
        room: payload.room_name ? 'yes' : 'no',
      });

      const currentRoom = new lk.Room({
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      room = currentRoom;
      bindRoomEvents(lk, currentRoom);

      let micPublishError = null;
      const micPublishPromise = currentRoom.localParticipant.setMicrophoneEnabled(true)
        .catch((error) => {
          micPublishError = error;
          return null;
        });
      voiceDiagnostic('Microphone publish queued before connect');

      voiceDiagnostic('LiveKit connect starting', { urlHost: livekitHost });
      await currentRoom.connect(payload.url, payload.token);
      voiceDiagnostic('LiveKit connect completed', { urlHost: livekitHost });
      await micPublishPromise;
      if (micPublishError) throw micPublishError;

      micEnabled = true;
      outputMuted = false;
      setButtons(true);
      renderConnectedStatus();
      void syncLocalMicAnalysis(currentRoom);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const details = safeErrorDetails(error);
      console.error('[grok2api voice] startSession failed', error, details);
      appendChatkitMessage('system', `Voice connect failed: ${message}`);
      voiceErrorDiagnostic('Voice connect error details', details);
      showToast?.(message, 'error');
      setStatus(
        'is-error',
        text('webui.chatkit.statusError', '连接失败'),
        text('webui.chatkit.errorText', '连接没有建立成功，请检查麦克风权限后重试。'),
      );
      await teardownSession(false);
    } finally {
      if (startVoiceBtn && !room) startVoiceBtn.disabled = false;
    }
  };

  const togglePause = async () => {
    if (!room) return;
    micEnabled = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(micEnabled);
    setButtons(true);
    renderConnectedStatus();
    void syncLocalMicAnalysis(room);
  };

  const toggleOutputMute = () => {
    if (!room) return;
    outputMuted = !outputMuted;
    audioElements.forEach((node) => {
      node.muted = outputMuted;
    });
    setButtons(true);
    renderConnectedStatus();
  };

  const handlePrimaryAction = async () => {
    if (!room) {
      await startSession();
      return;
    }
    await togglePause();
  };

  const startFreshSession = async () => {
    if (!room) return;
    await teardownSession(true);
    await startSession();
  };

  voiceSelect?.addEventListener('change', persistVoicePreference);
  personalitySelect?.addEventListener('change', () => {
    renderInstructionVisibility();
    persistPersonalityPreference();
  });
  customPersonalityNameInput?.addEventListener('input', persistCustomInstructionPreference);
  instructionInput?.addEventListener('input', persistCustomInstructionPreference);
  saveCustomPersonalityBtn?.addEventListener('click', saveSelectedCustomPersonality);
  deleteCustomPersonalityBtn?.addEventListener('click', deleteSelectedCustomPersonality);
  chatkitComposer?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitChatkitText();
  });
  chatkitPromptInput?.addEventListener('input', resizeChatkitInput);
  chatkitPromptInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitChatkitText();
    }
  });
  startVoiceBtn?.addEventListener('click', () => {
    persistVoicePreference();
    void handlePrimaryAction();
  });
  muteVoiceBtn?.addEventListener('click', toggleOutputMute);
  newSessionBtn?.addEventListener('click', () => {
    void startFreshSession();
  });

  window.addEventListener('beforeunload', () => {
    if (room) void room.disconnect();
  });

  restoreVoicePreference();
  loadCustomPersonalities();
  renderPersonalityOptions();
  restorePersonalityPreference();
  renderInstructionVisibility();
  persistVoicePreference();
  renderConnectedStatus();
  setButtons(false);
  renderChatkitMessages();
})();
