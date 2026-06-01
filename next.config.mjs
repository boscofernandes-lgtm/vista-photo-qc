/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // transformers.js ships wasm/onnx assets; keep them external from server bundling
  serverExternalPackages: ["@huggingface/transformers"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.vistarooms.com" },
    ],
  },
};

export default nextConfig;
