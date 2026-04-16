import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.racecor.overlay.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: true,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return `file:///${path.resolve(path.dirname(sourcemapPath), relativeSourcePath).replace(/\\/g, "/")}`;
    },
  },
  plugins: [
    typescript(),
    resolve({
      browser: false,
      preferBuiltins: true,
      exportConditions: ["node"],
    }),
    commonjs(),
  ],
};
