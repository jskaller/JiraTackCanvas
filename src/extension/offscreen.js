/**
 * Offscreen recorder (D37).
 *
 * Chrome MV3 cannot call chrome.tabCapture.capture from a service worker, and
 * a content script cannot consume the stream id. The standard shape is an
 * offscreen document: the worker gets a stream id for the active tab, this page
 * consumes it with getUserMedia, records WebM, and posts the data URL back.
 *
 * No picker is shown. The stream is restricted to the tab the reviewer is on.
 */
var stream = null;
var recorder = null;
var chunks = [];
var timer = null;
var request = null;

function send(payload) {
  try {
    chrome.runtime.sendMessage(payload, function () {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // The worker was reloaded; there is nowhere to deliver the result.
  }
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach(function (track) {
      try { track.stop(); } catch (e) { /* ignore */ }
    });
    stream = null;
  }
}

function reset() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  recorder = null;
  chunks = [];
}

function finish() {
  var current = request;
  if (!current) return;
  var recorded = chunks;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  recorder = null;
  chunks = [];
  request = null;
  stopStream();
  var blob = new Blob(recorded, { type: 'video/webm' });

  if (!blob.size) {
    send({
      type: 'jiratack-offscreen-error',
      requestId: current.requestId,
      tabId: current.tabId,
      message: 'The recording was empty.',
    });
    return;
  }

  var reader = new FileReader();
  reader.onload = function () {
    send({
      type: 'jiratack-offscreen-result',
      requestId: current.requestId,
      tabId: current.tabId,
      dataUrl: String(reader.result || ''),
    });
  };
  reader.onerror = function () {
    send({
      type: 'jiratack-offscreen-error',
      requestId: current.requestId,
      tabId: current.tabId,
      message: 'The recording could not be read.',
    });
  };
  reader.readAsDataURL(blob);
}

function stop() {
  if (!recorder) return;
  try {
    if (recorder.state !== 'inactive') recorder.stop();
  } catch (e) {
    // The stream may already have ended.
  }
}

function start(message) {
  if (recorder) {
    send({
      type: 'jiratack-offscreen-error',
      requestId: message.requestId,
      tabId: message.tabId,
      message: 'A recording is already in progress.',
    });
    return;
  }
  reset();
  request = { requestId: message.requestId, tabId: message.tabId };

  var video = {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: message.streamId,
    },
  };

  navigator.mediaDevices.getUserMedia({ audio: true, video: video })
    .catch(function () {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: video });
    })
    .then(function (mediaStream) {
      stream = mediaStream;
      var mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
        .find(function (type) { return MediaRecorder.isTypeSupported(type); });
      if (!mimeType) {
        finish();
        return;
      }
      recorder = new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 1500000 });
      chunks = [];
      recorder.addEventListener('dataavailable', function (event) {
        if (event.data && event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', finish);
      stream.getVideoTracks().forEach(function (track) {
        track.addEventListener('ended', stop);
      });
      recorder.start();
      timer = setTimeout(stop, 60000);
      send({
        type: 'jiratack-offscreen-started',
        requestId: request.requestId,
        tabId: request.tabId,
      });
    })
    .catch(function (error) {
      var current = request;
      reset();
      stopStream();
      request = null;
      if (!current) return;
      send({
        type: 'jiratack-offscreen-error',
        requestId: current.requestId,
        tabId: current.tabId,
        message: (error && error.message) || 'The current tab could not be recorded.',
      });
    });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return;
  if (message.type === 'jiratack-offscreen-start') {
    start(message);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'jiratack-offscreen-stop') {
    stop();
    sendResponse({ ok: true });
  }
});
