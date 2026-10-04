/**
 * WebAudioBalance - AudioSource Abstraction & TabCapture Backend
 */

export class BaseAudioSource {
  constructor() {
    this.stream = null;
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const list = this.listeners.get(event) || [];
    list.forEach((fn) => {
      try { fn(data); } catch (e) { console.error('AudioSource event listener error', e); }
    });
  }

  async acquire() {
    throw new Error('acquire() must be implemented by subclass');
  }

  release() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) {}
      });
      this.stream = null;
    }
    this.listeners.clear();
  }

  getStream() {
    return this.stream;
  }
}

/**
 * TabCaptureAudioSource
 * Primary capture backend validated in P0
 */
export class TabCaptureAudioSource extends BaseAudioSource {
  constructor(streamId) {
    super();
    this.streamId = streamId;
  }

  async acquire() {
    if (!this.streamId) {
      throw new Error('Cannot acquire TabCaptureAudioSource: missing streamId');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: this.streamId
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: this.streamId
        }
      }
    });

    // Immediately stop redundant video track to free graphics compositor resources
    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach((t) => {
      try { t.stop(); } catch (_) {}
    });

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      throw new Error('TabCaptureAudioSource acquired stream without audio tracks');
    }

    const audioTrack = audioTracks[0];

    audioTrack.onended = () => {
      this.emit('ended', { trackId: audioTrack.id });
    };

    audioTrack.onmute = () => {
      this.emit('mute', { trackId: audioTrack.id });
    };

    audioTrack.onunmute = () => {
      this.emit('unmute', { trackId: audioTrack.id });
    };

    this.stream = stream;
    return stream;
  }

  getAudioTrack() {
    return this.stream?.getAudioTracks()[0] || null;
  }
}
