#[tauri::command]
pub fn open_keyboard_settings() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        use std::mem::ManuallyDrop;

        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("No se pudo obtener JavaVM: {e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("No se pudo adjuntar el hilo a la JVM: {e}"))?;

        let context =
            ManuallyDrop::new(unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) });
        let action = env
            .new_string("android.settings.INPUT_METHOD_SETTINGS")
            .map_err(|e| format!("No se pudo crear la acción de ajustes: {e}"))?;
        let intent = env
            .new_object(
                "android/content/Intent",
                "(Ljava/lang/String;)V",
                &[(&action).into()],
            )
            .map_err(|e| format!("No se pudo crear el intent de ajustes: {e}"))?;
        env.call_method(
            &intent,
            "addFlags",
            "(I)Landroid/content/Intent;",
            &[0x1000_0000i32.into()],
        )
        .map_err(|e| format!("No se pudo configurar el intent de ajustes: {e}"))?;
        env.call_method(
            &*context,
            "startActivity",
            "(Landroid/content/Intent;)V",
            &[(&intent).into()],
        )
        .map_err(|e| format!("No se pudieron abrir los ajustes de teclado: {e}"))?;
        Ok(true)
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(false)
    }
}
