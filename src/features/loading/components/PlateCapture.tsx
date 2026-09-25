import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera } from 'lucide-react';
import type { PlateCaptureState } from '../utils/plateCaptureController';
import { CameraSession, captureGuideFrame, classifyCameraFailure, type CameraFailure } from '../utils/cameraSession';

type Props = { state: PlateCaptureState; disabled: boolean; resetKey?: string;
  onCapture: (file: File) => void; onManual: () => void; onScanStart: () => void };
type CameraState = 'idle' | 'initializing' | 'preview' | 'capturing' | CameraFailure;

export function PlateCapture({ state, disabled, resetKey, onCapture, onManual, onScanStart }: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef(new CameraSession(constraints => navigator.mediaDevices.getUserMedia(constraints)));
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);

  function closeCamera() {
    camera.current.stop();
    if (video.current) video.current.srcObject = null;
    setStream(null);
    setCameraState('idle');
  }

  useEffect(() => {
    camera.current.stop();
    return () => camera.current.stop();
  }, []);

  useEffect(() => {
    // A changed plate, assignment or locked workflow must not retain a live preview.
    closeCamera();
    // resetKey and disabled are the operational context, not camera callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, disabled]);

  useEffect(() => {
    if (!stream || !video.current) return;
    const element = video.current;
    element.srcObject = stream;
    void element.play().catch(() => {
      if (!camera.current.isActive(stream)) return;
      camera.current.stop();
      element.srcObject = null;
      setStream(null);
      setCameraState('initialization_failed');
    });
    return () => { element.srcObject = null; };
  }, [stream]);

  async function startCamera() {
    if (disabled || cameraState === 'initializing' || cameraState === 'capturing') return;
    onScanStart();
    closeCamera();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return;
    }
    setCameraState('initializing');
    try {
      const opened = await camera.current.start();
      if (opened) { setStream(opened); setCameraState('preview'); }
    } catch (error) {
      setCameraState(classifyCameraFailure(error));
    }
  }

  async function captureFrame() {
    if (cameraState !== 'preview' || !video.current) return;
    const generation = camera.current.generation;
    setCameraState('capturing');
    try {
      const file = await captureGuideFrame(video.current);
      if (generation !== camera.current.generation) return;
      closeCamera();
      onCapture(file);
    } catch {
      if (generation !== camera.current.generation) return;
      closeCamera();
      setCameraState('initialization_failed');
    }
  }

  function selected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) { closeCamera(); onCapture(file); }
  }
  return <section className="loading-scanner" aria-label="Plate scanner">
    <h3>Scan plate</h3>
    <p>Centre the number plate in the photo. OCR suggests a plate; you must confirm it below.</p>
    <button className="button loading-scan-button" type="button" disabled={disabled}
      onClick={() => { void startCamera(); }}>
      <Camera size={20} aria-hidden="true" /> Scan Number Plate
    </button>
    <button className="button secondary loading-photo-button" type="button" disabled={disabled}
      onClick={() => { closeCamera(); imageInput.current?.click(); }}>Choose Photo</button>
    <input ref={imageInput} id="loading-plate-image" type="file" accept="image/*"
      onChange={selected} disabled={disabled} aria-label="Capture or choose plate image" hidden />
    {(cameraState === 'preview' || cameraState === 'capturing') && <div className="loading-camera-view">
      <div className="loading-camera-preview"><video ref={video} autoPlay muted playsInline aria-label="Live plate camera preview" />
        <div className="loading-camera-guide" aria-hidden="true" /></div>
      <p>Place the number plate inside the guide.</p>
      <div className="loading-camera-actions">
        <button className="button" type="button" disabled={cameraState === 'capturing'}
          onClick={() => { void captureFrame(); }}>Capture Plate</button>
        <button className="button secondary" type="button" onClick={closeCamera}>Cancel camera</button>
      </div>
    </div>}
    {cameraState === 'initializing' && <p role="status">Starting camera…</p>}
    {cameraState === 'permission_denied' && <p role="alert">Camera permission was denied. Allow camera access or choose a photo. Manual entry remains available.</p>}
    {cameraState === 'unavailable' && <p role="alert">Camera unavailable. Use HTTPS or localhost, choose a photo, or enter the plate manually.</p>}
    {cameraState === 'initialization_failed' && <p role="alert">Camera could not start or capture the image. Choose a photo or enter the plate manually.</p>}
    {state.status === 'processing' && <p role="status">{
      state.phase === 'preparing_image' ? 'Preparing plate image…'
        : state.phase === 'loading_model' ? 'Loading on-device OCR model…'
          : 'Reading the plate image…'
    } Manual entry remains available.</p>}
    {state.status === 'detected' && <div className="loading-scan-result" role="status">
      <span>Detected plate</span><strong>{state.evidence.candidate}</strong>
      <p>Check or correct the plate below, then select Find Truck. No lookup has started.</p>
      <button className="button secondary" type="button" disabled={disabled} onClick={onManual}>Use manual entry instead</button>
    </div>}
    {state.status === 'error' && <div className="loading-scan-error" role="status">
      <p>{state.reason === 'invalid_image' ? 'The image could not be prepared. Use a JPEG or PNG photo.'
        : state.reason === 'model_unavailable' ? 'On-device OCR could not load. Check your connection and retry the scan.'
          : state.reason === 'no_plate' ? 'No plausible plate was detected. Capture again or enter the plate manually.'
            : 'The plate image could not be read. Capture again or enter the plate manually.'}</p>
      <button className="button secondary" type="button" disabled={disabled} onClick={onManual}>Use manual entry</button>
    </div>}
  </section>;
}
