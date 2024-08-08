/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // !deprecated
    // domains: [
    //     "res.cloudinary.com"
    // ]
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
};

export default nextConfig;
