#[cfg(target_os = "android")]
pub fn read_android_asset(path: &str) -> Result<Vec<u8>, String> {
    use std::{ffi::CString, io::Read, mem::ManuallyDrop, ptr::NonNull};

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("No se pudo obtener JavaVM: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("No se pudo adjuntar el hilo a la JVM: {e}"))?;

    let context_obj =
        ManuallyDrop::new(unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) });
    let assets_obj = env
        .call_method(
            &*context_obj,
            "getAssets",
            "()Landroid/content/res/AssetManager;",
            &[],
        )
        .map_err(|e| format!("No se pudo obtener AssetManager: {e}"))?
        .l()
        .map_err(|e| format!("AssetManager inválido: {e}"))?;

    let env_ptr = env.get_native_interface();
    let am_ptr = unsafe { ndk_sys::AAssetManager_fromJava(env_ptr as _, assets_obj.as_raw() as _) };
    let am_ptr =
        NonNull::new(am_ptr).ok_or_else(|| "AAssetManager_fromJava devolvió null".to_string())?;
    let manager = unsafe { ndk::asset::AssetManager::from_ptr(am_ptr) };

    let cpath = CString::new(path).map_err(|e| format!("Ruta de asset inválida: {e}"))?;
    let mut asset = manager
        .open(&cpath)
        .ok_or_else(|| format!("No se encontró el asset en el APK: {path}"))?;

    let mut buf = Vec::with_capacity(asset.length());
    asset
        .read_to_end(&mut buf)
        .map_err(|e| format!("No se pudo leer el asset {path}: {e}"))?;
    Ok(buf)
}
