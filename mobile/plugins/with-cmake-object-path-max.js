// Config plugin: cap CMake object-file paths in the app's native build.
//
// The app module compiles autolinked codegen (react-native-gesture-handler's
// shadow nodes, via expo-router) with object paths such as
//   .cxx/RelWithDebInfo/<hash>/arm64-v8a/rngesturehandler_codegen_autolinked_build/
//   CMakeFiles/react_codegen_rngesturehandler_codegen.dir/C_/<project>/mobile/
//   node_modules/react-native-gesture-handler/shared/shadowNodes/.../*.cpp.o
// which is ~330 characters even from C:\afxc. The ninja 1.10.2 shipped with the
// Android SDK's CMake rejects any path over 260 characters on Windows, with or
// without LongPathsEnabled. CMAKE_OBJECT_PATH_MAX makes CMake hash object names
// whose full path would be longer. No effect on builds whose paths are short.
const { withAppBuildGradle } = require("expo/config-plugins");

const ARG = "-DCMAKE_OBJECT_PATH_MAX=240";

module.exports = function withCmakeObjectPathMax(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("with-cmake-object-path-max: expected a Groovy app/build.gradle");
    }
    const src = cfg.modResults.contents;
    if (src.includes(ARG)) return cfg;
    const anchor = /(\n\s*defaultConfig\s*\{\n)/;
    if (!anchor.test(src)) {
      throw new Error("with-cmake-object-path-max: defaultConfig block not found in app/build.gradle");
    }
    cfg.modResults.contents = src.replace(
      anchor,
      `$1        externalNativeBuild {\n            cmake {\n                arguments "${ARG}"\n            }\n        }\n`,
    );
    return cfg;
  });
};
