# Loading OCR browser assets

The Loading Portal uses the official `@paddleocr/paddleocr-js` SDK with the
`PP-OCRv5_mobile_det` and `PP-OCRv5_mobile_rec` models. Its OCR service requests
both model archives and the ONNX Runtime WASM files from this application's own
origin. OCR runs in a browser worker; no plate image is sent to an OCR API.

The archives in `public/ocr-models/` are the official uncompressed ONNX model
archives from PaddleOCR's model host:

- `PP-OCRv5_mobile_det_onnx_infer.tar`: SHA-256 `781056046C9ED77A15C94681605DB6A0F62317C2E9CCE6931C71DA2478D4BC30`
- `PP-OCRv5_mobile_rec_onnx_infer.tar`: SHA-256 `F7E792BC836F36E7EF895AD47C426D75B0B75B1650CAA6D63FE9418441FFBA8C`

Source: `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/`.
The four files in `public/ocr-runtime/` are copied from the installed
`onnxruntime-web/dist` package. The SDK worker requests the `.jsep.mjs` and
`.jsep.wasm` pair. Keep all files in sync when upgrading the SDK. The JSEP WASM
SHA-256 is `3AD23231B5BD6D9DDA55A7F84606315E0BF35B6750C28EE993C987C54CACAB0F`;
the non-JSEP WASM SHA-256 is `3398C10D07D229BD91B364548E130E0E51A8E5704B88C7C083EBBEB78842DEE2`.

Deploy the contents of `public/` alongside the Vite build. Missing model/WASM
assets make OCR unavailable; photo selection and manual plate entry remain usable.
The officer must confirm or correct every OCR suggestion before Find Truck.
