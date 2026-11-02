const path = require("path");
const webpack = require("webpack");

const RESVG_EXTERNAL = "commonjs ./resvg-runtime/resvg-js";

// Optional native accelerators of ws/jsdom. They are always required inside
// try/catch, so the runtime require fails cleanly when they are not installed
// (VSIX ships no node_modules) and the JS fallbacks take over.
const OPTIONAL_NATIVE_EXTERNALS = {
  canvas: "commonjs canvas",
  bufferutil: "commonjs bufferutil",
  "utf-8-validate": "commonjs utf-8-validate"
};

const config = {
  entry: "./src/extension.ts",
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode",
    child_process: "commonjs child_process",
    util: "commonjs util",
    "@resvg/resvg-js": RESVG_EXTERNAL,
    "@b9g/termdom": "commonjs @b9g/termdom",
    ...OPTIONAL_NATIVE_EXTERNALS
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
    alias: {
      "codetour-description-renderer": path.resolve(
        __dirname,
        "packages/description-renderer/dist/src/index.js"
      ),
      // The CLI bundle embeds the shared MCP server entry exactly once, from
      // the same source as the npm binary and the VSIX server bundle.
      "codetour-mcp": path.resolve(
        __dirname,
        "packages/mcp-server/dist/src/cli.js"
      )
    }
  },
  node: {
    __filename: false,
    __dirname: false
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader"
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      test: /\.ts$/,
      noSources: false,
      module: true,
      columns: true
    })
  ]
};

const nodeConfig = {
  ...config,
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension-node.js',
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  plugins: [
    ...config.plugins,
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
  ]
};

const mcpConfig = {
  mode: "production",
  target: "node18",
  entry: "./packages/mcp-server/dist/src/main.js",
  externals: {
    "@resvg/resvg-js": RESVG_EXTERNAL,
    ...OPTIONAL_NATIVE_EXTERNALS
  },
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "mcp-server.js"
  }
};

const cliConfig = {
  ...nodeConfig,
  entry: "./src/cli/index.ts",
  output: { ...nodeConfig.output, filename: "cli.js" },
  externals: {
    ...nodeConfig.externals,
    // markdown-it (through the shared renderer) requires the deprecated
    // `punycode` core module, which prints a DeprecationWarning on every
    // start. Point the external at the userland package (tracked as a
    // standalone dependency closure, like @b9g/termdom) so `codetour mcp`
    // writes nothing to stderr, like the codetour-mcp binary.
    punycode: "commonjs punycode/"
  },
  plugins: [
    ...nodeConfig.plugins,
    new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true, entryOnly: true })
  ]
};

module.exports = [nodeConfig, mcpConfig, cliConfig];
