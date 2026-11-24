# Wrapper toolchain for building whisper-rs-sys/ggml on Android via cargo/tauri.
# cmake-rs/whisper-rs-sys do not forward ANDROID_* vars reliably; set them here
# and include the official NDK toolchain.

if(NOT DEFINED ANDROID_ABI)
  if(DEFINED CMAKE_ANDROID_ARCH_ABI)
    set(ANDROID_ABI "${CMAKE_ANDROID_ARCH_ABI}")
  elseif(DEFINED ENV{ANDROID_ABI})
    set(ANDROID_ABI "$ENV{ANDROID_ABI}")
  endif()
endif()

if(NOT DEFINED ANDROID_PLATFORM)
  if(DEFINED ENV{ANDROID_PLATFORM})
    set(ANDROID_PLATFORM "$ENV{ANDROID_PLATFORM}")
  elseif(DEFINED CMAKE_SYSTEM_VERSION)
    set(ANDROID_PLATFORM "android-${CMAKE_SYSTEM_VERSION}")
  endif()
endif()

if(NOT DEFINED ANDROID_STL)
  if(DEFINED ENV{ANDROID_STL})
    set(ANDROID_STL "$ENV{ANDROID_STL}")
  else()
    set(ANDROID_STL "c++_shared")
  endif()
endif()

if(NOT DEFINED ANDROID_NDK)
  if(DEFINED CMAKE_ANDROID_NDK)
    set(ANDROID_NDK "${CMAKE_ANDROID_NDK}")
  elseif(DEFINED ENV{NDK_HOME})
    set(ANDROID_NDK "$ENV{NDK_HOME}")
  elseif(DEFINED ENV{ANDROID_NDK_HOME})
    set(ANDROID_NDK "$ENV{ANDROID_NDK_HOME}")
  elseif(DEFINED ENV{ANDROID_NDK_ROOT})
    set(ANDROID_NDK "$ENV{ANDROID_NDK_ROOT}")
  endif()
endif()

if(NOT DEFINED ANDROID_NDK)
  message(FATAL_ERROR "Android NDK not found. Set NDK_HOME/CMAKE_ANDROID_NDK.")
endif()

include("${ANDROID_NDK}/build/cmake/android.toolchain.cmake")
