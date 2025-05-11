/* eslint-disable no-template-curly-in-string */
module.exports = {
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: "dist/*.js",
      },
    ],
    "@qiwi/semantic-release-gh-pages-plugin",
  ],
  preset: "conventionalcommits",
  branches: [{ name: "main" }, { name: "dev", prerelease: true }],
};
