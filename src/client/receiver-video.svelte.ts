import {
  getIncomingFormat,
  getVideoElementState,
  readPathDiagnostics,
  sampleVideoFrame,
} from "./receiver-diagnostics";
import { errorMessage } from "./utils";

type ReceiverVideoCallbacks = {
  onRelayDetected: () => void;
  onLog: (message: string) => void;
};

export function createReceiverVideo(callbacks: ReceiverVideoCallbacks) {
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let incomingFrames = 0;
  let lastIncomingAt = 0;
  let lastFrameSampleAt = 0;

  let incomingSummary = $state("Waiting");
  let pathSummary = $state("Local direct only");
  let incomingFormat = $state("Waiting");
  let videoElementState = $state("Waiting");
  let frameSample = $state("Waiting");
  let inboundStats = $state("Waiting");
  let selectedPath = $state("Waiting");
  let localCandidate = $state("Waiting");
  let remoteCandidate = $state("Waiting");
  let relayState = $state("Blocked by configuration");

  function setVideo(node: HTMLVideoElement): void {
    video = node;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    if (stream) {
      video.srcObject = stream;
      tryPlay("video element remounted");
    }
  }

  function attachStream(nextStream: MediaStream): boolean {
    stream = nextStream;
    if (!video) {
      return false;
    }
    video.srcObject = nextStream;
    return true;
  }

  function clear(): void {
    stream = null;
    if (video) {
      video.srcObject = null;
    }
    incomingFrames = 0;
    lastIncomingAt = 0;
    lastFrameSampleAt = 0;
  }

  function trackIncomingVideo(): void {
    if (!video) {
      return;
    }
    for (const eventName of [
      "loadedmetadata",
      "playing",
      "waiting",
      "stalled",
      "pause",
      "resize",
      "error",
    ]) {
      video.addEventListener(eventName, () => {
        callbacks.onLog(`Video event: ${eventName}`);
        updateElementState();
      });
    }

    if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
      video.addEventListener("resize", () => updateIncomingFormat());
      return;
    }

    const onFrame: VideoFrameRequestCallback = (now) => {
      incomingFrames += 1;
      if (!lastIncomingAt) {
        lastIncomingAt = now;
      }
      if (now - lastIncomingAt > 1000) {
        const fps = (incomingFrames * 1000) / (now - lastIncomingAt);
        incomingFrames = 0;
        lastIncomingAt = now;
        updateIncomingFormat(fps);
        updateElementState();
        sampleRemoteFrame(now);
      }
      video?.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  function updateIncomingFormat(fps?: number): void {
    const next = getIncomingFormat(video, fps);
    incomingFormat = next.format;
    incomingSummary = next.summary;
  }

  function tryPlay(reason: string): void {
    if (!video?.srcObject) {
      return;
    }
    video
      .play()
      .then(() => {
        callbacks.onLog(`Video playback started (${reason}).`);
        updateElementState();
      })
      .catch((error: unknown) => {
        callbacks.onLog(`Video play blocked (${reason}): ${errorMessage(error)}`);
        videoElementState = "play blocked; click receiver page once";
      });
  }

  async function pollPath(peer: RTCPeerConnection): Promise<void> {
    const diagnostics = await readPathDiagnostics(peer, video);
    if (diagnostics.inboundStats) {
      inboundStats = diagnostics.inboundStats;
    }
    if (diagnostics.selectedPath) {
      selectedPath = diagnostics.selectedPath;
    }
    if (diagnostics.pathSummary) {
      pathSummary = diagnostics.pathSummary;
    }
    if (diagnostics.localCandidate) {
      localCandidate = diagnostics.localCandidate;
    }
    if (diagnostics.remoteCandidate) {
      remoteCandidate = diagnostics.remoteCandidate;
    }
    if (diagnostics.relayState) {
      relayState = diagnostics.relayState;
    }
    if (diagnostics.relayDetected) {
      callbacks.onRelayDetected();
    }
  }

  function updateElementState(): void {
    videoElementState = getVideoElementState(video);
  }

  function sampleRemoteFrame(now = performance.now()): void {
    if (now - lastFrameSampleAt < 1000 || !video?.videoWidth || !video.videoHeight) {
      return;
    }
    lastFrameSampleAt = now;
    frameSample = sampleVideoFrame(video);
  }

  return {
    get incomingSummary() {
      return incomingSummary;
    },
    get pathSummary() {
      return pathSummary;
    },
    get incomingFormat() {
      return incomingFormat;
    },
    get videoElementState() {
      return videoElementState;
    },
    get frameSample() {
      return frameSample;
    },
    get inboundStats() {
      return inboundStats;
    },
    get selectedPath() {
      return selectedPath;
    },
    get localCandidate() {
      return localCandidate;
    },
    get remoteCandidate() {
      return remoteCandidate;
    },
    get relayState() {
      return relayState;
    },
    setVideo,
    attachStream,
    clear,
    trackIncomingVideo,
    tryPlay,
    pollPath,
  };
}
