import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // PaddleOCR resolves its module worker relative to its published package.
  // Prebundling moves index.mjs into .vite/deps without moving that worker.
  optimizeDeps: {
    exclude: ['@paddleocr/paddleocr-js'],
    include: ['clipper-lib', '@techstark/opencv-js', 'js-yaml', 'onnxruntime-web'],
  },
  server: {
    port: 5174, // use 5174 since user had another port in use
    host: true,
  },
});
