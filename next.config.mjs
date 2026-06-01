/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // transformers.js ships wasm/onnx assets; keep them external from server bundling
  serverExternalPackages: ["@huggingface/transformers"],
  // CLIP runs only in the browser, but Next traces @huggingface/transformers'
  // optional Node backend (onnxruntime-node, ~400 MB) into the serverless
  // function, blowing past Vercel's 250 MB limit. Exclude the native runtime
  // (and sharp's libvips) from every function trace — none of it is used server-side.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/onnxruntime-node/**",
      "node_modules/@img/sharp-libvips-*/**",
      "node_modules/@huggingface/transformers/**",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.vistarooms.com" },
    ],
  },
};

export default nextConfig;
