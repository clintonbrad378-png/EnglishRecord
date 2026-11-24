import pathlib
import sys

p = pathlib.Path(sys.argv[1])
s = p.read_text()
changed = False

old = 'let is_cmake_flag = key.starts_with("CMAKE_");'
new = '''let is_cmake_flag = key.starts_with("CMAKE_")
            || key == "ANDROID_ABI"
            || key == "ANDROID_PLATFORM"
            || key == "ANDROID_NDK"
            || key == "ANDROID_STL"
            || key == "ANDROID_NATIVE_API_LEVEL";'''
if old in s:
    s = s.replace(old, new)
    changed = True
    print('patched cmake flags')
else:
    print('cmake flag pattern not found or already patched')

old2 = '''    if cfg!(not(feature = "openmp")) {
        config.define("GGML_OPENMP", "OFF");
    }'''
new2 = '''    if cfg!(not(feature = "openmp")) {
        config.define("GGML_OPENMP", "OFF");
    }

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        config.define("GGML_NATIVE", "OFF");
        config.define("GGML_LLAMAFILE", "OFF");
        config.define("GGML_BACKEND_DL", "OFF");
        config.define("BUILD_SHARED_LIBS", "OFF");
    }'''
if old2 in s:
    s = s.replace(old2, new2)
    changed = True
    print('patched android config')
else:
    print('android config pattern not found or already patched')

if changed:
    p.write_text(s)
