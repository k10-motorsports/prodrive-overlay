import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.racecor.overlay.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return `file:///${path.resolve(path.dirname(sourcemapPath), relativeSourcePath).replace(/\\/g, "/")}`;
    },
  },
  external: [
    /^node:/,
    "ws",
  ],
  plugins: [
    typescript(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({
          fileName: "package.json",
          source: `{"type":"module"}`,
          type: "asset",
        });
      },
    },
    resolve({
      browser: false,
      exportConditions: ["node"],
    }),
  ],
};
