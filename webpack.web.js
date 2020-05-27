const devConfig = require("./webpack.config.js");
const merge = require("webpack-merge");

module.exports = merge(devConfig, {
  target: "webworker"
});
