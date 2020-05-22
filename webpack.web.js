const devConfig = require("./webpack.config.js");
const merge = require("webpack-merge");
const path = require("path");

module.exports = merge(devConfig, {
  target: "webworker"
});
