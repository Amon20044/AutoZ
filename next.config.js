const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

const withSerwist = require('@serwist/next').default({
  swSrc: 'app/sw.js',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
})

const nextConfig = {
  // uncomment the following snippet if using styled components
  // compiler: {
  //   styledComponents: true,
  // },
  // StrictMode double-mounts components in dev. R3F's <Canvas> allocates a
  // fresh WebGL context per mount, and Chromium kills the oldest context
  // when the per-page cap is hit — that's the "Context Lost" we kept seeing
  // on /editor/demo. Disabling StrictMode in dev stops the double-mount and
  // the canvas stays alive. Production builds are unaffected.
  reactStrictMode: false,
  experimental: {
    proxyClientMaxBodySize: '250mb',
  },
  images: {},
  webpack(config, { isServer }) {
    if (!isServer) {
      // We're in the browser build, so we can safely exclude the sharp module
      config.externals.push('sharp')
    }
    // audio support
    config.module.rules.push({
      test: /\.(ogg|mp3|wav|mpe?g)$/i,
      exclude: config.exclude,
      use: [
        {
          loader: require.resolve('url-loader'),
          options: {
            limit: config.inlineImageLimit,
            fallback: require.resolve('file-loader'),
            publicPath: `${config.assetPrefix}/_next/static/images/`,
            outputPath: `${isServer ? '../' : ''}static/images/`,
            name: '[name]-[hash].[ext]',
            esModule: config.esModule || false,
          },
        },
      ],
    })

    // shader support
    config.module.rules.push({
      test: /\.(glsl|vs|fs|vert|frag)$/,
      exclude: /node_modules/,
      use: ['raw-loader', 'glslify-loader'],
    })

    return config
  },
}

module.exports = () => {
  const plugins = [[withSerwist], [withBundleAnalyzer, {}]]

  return plugins.reduce((acc, [plugin, config]) => plugin({ ...acc, ...config }), nextConfig)
}
