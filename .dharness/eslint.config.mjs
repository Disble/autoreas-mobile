// dharness writes this file. It exports a factory rather than a config
// array because the packages it names are installed beside the project's
// package.json, and a bare specifier resolves from the file that writes it
// — which, in a split layout, is not this directory.
export default function dharnessLayer({ plugin, dharnessExpo }) {
  return [
    { ignores: [".dharness/**"] },
    ...dharnessExpo,
    {
      plugins: { dharness: plugin },
      rules: {
        "dharness/folder-ownership": "error",
        "dharness/max-file-lines": "error",
        "dharness/pure-index-barrel": "error",
        "dharness/require-jsdoc": "error",
        "dharness/require-variable-jsdoc": "error",
        "dharness/role-file-shape": "error",
      },
    },
  ];
}
