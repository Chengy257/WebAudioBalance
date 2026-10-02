/**
 * WebAudioBalance P0 Feasibility Harness - Offscreen Audio Runtime (Audio Plane)
 * Manages MediaStreams, AudioContexts, Web Audio routing, test gain, and RMS metering.
 */

import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';

const logger = new StructuredLogger('OffscreenAudioRuntime');

// Map of active tab sessions: tabId -> session
const activeSessions = new Map();

logger.info('Offscreen audio runtime initialized', { env: getBrowserInfo() });

// Notify that offscreen document is ready
chrome.runtime.sendMessage(createMessage(MessageTypes.AUDIO_RUNTIME_READY, MessageTargets.SERVICE_WORKER)).catch(() => {});

/**
 * Start capture for a given tabId using acquired streamId
 */
async function startCaptureSession(tabId, streamId) {
  if (activeSessions.has(tabId)) {
    logger.warn('Stopping existing session for tab before restarting', { tabId });
    stopCaptureSession(tabId);
  }

  logger.info('Starting capture session in offscreen', { tabId, streamId });

  try {
    // Request stream using streamId redeemed via getUserMedia
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    });

    // Immediately stop video track as WebAudioBalance only processes audio
    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach((track) => {
      track.stop();
    });

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      throw new Error('No audio track present in captured MediaStream');
    }

    const audioTrack = audioTracks[0];
    logger.info('Audio track acquired', {
      tabId,
      trackId: audioTrack.id,
      readyState: audioTrack.readyState,
      muted: audioTrack.muted,
      settings: audioTrack.getSettings ? audioTrack.getSettings() : {}
    });

    // Initialize AudioContext
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Audio Graph: MediaStreamSource -> GainNode -> Destination
    // Observation Graph: MediaStreamSource -> AnalyserNode
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const gainNode = audioCtx.createGain();
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;

    // Connect observation branch (meter)
    sourceNode.connect(analyserNode);

    // Connect audible processing branch
    sourceNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // Initial default test gain: 0 dB (unity gain)
    gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    const session = {
      tabId,
      streamId,
      stream,
      audioCtx,
      sourceNode,
      gainNode,
      analyserNode,
      currentGainDb: 0,
      captureStatus: 'RUNNING',
      startedAt: Date.now(),
      lastMetricAt: Date.now(),
      lastRmsDbFS: -100,
      meterInterval: null
    };

    // Track ended listener (e.g. Tab navigation, tab closed, or capture stopped)
    audioTrack.onended = () => {
      logger.warn('Audio track ended event received', { tabId, trackReadyState: audioTrack.readyState });
      session.captureStatus = 'STOPPED';
      broadcastSessionState(tabId);
    };

    // Level metering loop (250ms interval)
    const pcmBuffer = new Float32Array(analyserNode.fftSize);
    session.meterInterval = setInterval(() => {
      if (session.captureStatus !== 'RUNNING') return;

      analyserNode.getFloatTimeDomainData(pcmBuffer);
      let sum = 0;
      for (let i = 0; i < pcmBuffer.length; i++) {
        sum += pcmBuffer[i] * pcmBuffer[i];
      }
      const rms = Math.sqrt(sum / pcmBuffer.length);
      const rmsDbFS = rms > 1e-5 ? Number((20 * Math.log10(rms)).toFixed(1)) : -100;

      session.lastRmsDbFS = rmsDbFS;
      session.lastMetricAt = Date.now();

      // Send metrics update to popup
      chrome.runtime.sendMessage(createMessage(MessageTypes.METRICS_UPDATE, MessageTargets.POPUP, {
        tabId,
        rmsDbFS,
        currentGainDb: session.currentGainDb,
        audioContextState: audioCtx.state,
        trackReadyState: audioTrack.readyState
      })).catch(() => {});
    }, 250);

    activeSessions.set(tabId, session);

    logger.info('Session successfully established', {
      tabId,
      audioCtxState: audioCtx.state,
      sampleRate: audioCtx.sampleRate
    });

    broadcastSessionState(tabId);
    return { success: true, tabId };
  } catch (err) {
    logger.error('Failed to establish capture session in offscreen', { tabId, error: err.message, stack: err.stack });
    chrome.runtime.sendMessage(createMessage(MessageTypes.CAPTURE_ERROR, MessageTargets.POPUP, {
      tabId,
      error: err.message
    })).catch(() => {});
    throw err;
  }
}

/**
 * Apply deterministic test gain in dB
 */
function setTestGain(tabId, gainDb) {
  const session = activeSessions.get(tabId);
  if (!session) {
    logger.warn('Cannot set gain, session not found for tab', { tabId });
    return false;
  }

  // Convert dB to linear amplitude: A = 10^(dB / 20)
  const linearGain = Math.pow(10, gainDb / 20);
  const audioCtx = session.audioCtx;

  // Smooth ramp over 50ms to prevent clicking
  session.gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
  session.gainNode.gain.setValueAtTime(session.gainNode.gain.value, audioCtx.currentTime);
  session.gainNode.gain.linearRampToValueAtTime(linearGain, audioCtx.currentTime + 0.05);

  session.currentGainDb = gainDb;
  logger.info('Test gain applied', { tabId, gainDb, linearGain: Number(linearGain.toFixed(4)) });

  broadcastSessionState(tabId);
  return true;
}

/**
 * Stop capture and cleanly release all resources
 */
function stopCaptureSession(tabId) {
  const session = activeSessions.get(tabId);
  if (!session) {
    logger.info('No active session to stop for tab', { tabId });
    return false;
  }

  logger.info('Stopping and cleaning up session for tab', { tabId });

  if (session.meterInterval) {
    clearInterval(session.meterInterval);
    session.meterInterval = null;
  }

  try {
    session.sourceNode.disconnect();
    session.gainNode.disconnect();
    session.analyserNode.disconnect();
  } catch (err) {
    logger.warn('Error disconnecting audio nodes', { error: err.message });
  }

  try {
    session.stream.getTracks().forEach((track) => {
      track.stop();
    });
  } catch (err) {
    logger.warn('Error stopping media tracks', { error: err.message });
  }

  try {
    if (session.audioCtx && session.audioCtx.state !== 'closed') {
      session.audioCtx.close();
    }
  } catch (err) {
    logger.warn('Error closing audio context', { error: err.message });
  }

  session.captureStatus = 'STOPPED';
  activeSessions.delete(tabId);

  chrome.runtime.sendMessage(createMessage(MessageTypes.CAPTURE_STOPPED, MessageTargets.POPUP, { tabId })).catch(() => {});
  logger.info('Session cleanup completed', { tabId });
  return true;
}

/**
 * Helper to build serializable state of all sessions
 */
function getSerializedRuntimeState() {
  const env = getBrowserInfo();
  const list = [];
  for (const [tabId, s] of activeSessions.entries()) {
    list.push({
      tabId,
      browser: env.browser,
      browserVersion: env.version,
      captureStatus: s.captureStatus,
      trackReadyState: s.stream.getAudioTracks()[0]?.readyState || 'ended',
      audioContextState: s.audioCtx.state,
      testGainDb: s.currentGainDb,
      rmsDbFS: s.lastRmsDbFS,
      startedAt: s.startedAt,
      lastMetricAt: s.lastMetricAt
    });
  }
  return list;
}

function broadcastSessionState(tabId) {
  const stateList = getSerializedRuntimeState();
  chrome.runtime.sendMessage(createMessage(MessageTypes.RUNTIME_STATE, MessageTargets.POPUP, {
    activeStreams: stateList,
    targetTabId: tabId
  })).catch(() => {});
}

/**
 * Message listener for offscreen audio runtime
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.target !== MessageTargets.OFFSCREEN && message.target !== MessageTargets.BROADCAST)) {
    return false;
  }

  const { type, payload } = message;

  switch (type) {
    case MessageTypes.START_CAPTURE:
      startCaptureSession(payload.tabId, payload.streamId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_TEST_GAIN:
      const ok = setTestGain(payload.tabId, payload.gainDb);
      sendResponse({ success: ok });
      return true;

    case MessageTypes.STOP_CAPTURE:
      const stopped = stopCaptureSession(payload.tabId);
      sendResponse({ success: stopped });
      return true;

    case MessageTypes.QUERY_RUNTIME_STATE:
      sendResponse({ activeStreams: getSerializedRuntimeState() });
      return true;

    default:
      return false;
  }
});
